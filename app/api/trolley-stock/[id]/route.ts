import connectDB from "@/lib/mongodb";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type UpdateBody = {
  material?: string;
  rairiInTrolley?: number;
  rairiPerTrolley?: number;
  actualRairi?: number;
  trolleyPrice?: number;
  date?: string;
  purpose?: "factory" | "direct_sale";
};

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}
function isValidId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

function getUserFilter(userId: string) {
  if (Types.ObjectId.isValid(userId)) return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  return { userId: userId };
}

const FROZEN_RAIRI = 60;

async function recalcStock(userId: string, normalizedMaterial: string) {
  const all = await TrolleyEntryModel.find({
    ...getUserFilter(userId),
    normalizedMaterial: normalizedMaterial,
  }).lean();

  let totalRairi = 0;
  let totalCost = 0;
  for (const e of all) {
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley ?? 0);
    const remaining = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    if (remaining <= 0) continue;
    const rate = Number((e.perRairiRate || 0).toFixed(2));
    totalRairi += remaining;
    totalCost += remaining * rate;
  }
  const avgRate = totalRairi > 0 ? Number((totalCost / totalRairi).toFixed(2)) : 0;

  if (totalRairi <= 0) {
    // ✅ FIX: getUserFilter
    await TrolleyStockModel.deleteOne({
      ...getUserFilter(userId),
      normalizedMaterial: normalizedMaterial,
    });
  } else {
    await TrolleyStockModel.updateOne(
      { ...getUserFilter(userId), normalizedMaterial: normalizedMaterial },
      { 
        $set: { totalRairi: rnd(totalRairi), totalCost: Math.round(totalCost), avgRate, updatedAt: new Date() },
        $setOnInsert: {
          localId: `stock_${normalizedMaterial}_${Date.now()}`,
          normalizedMaterial: normalizedMaterial,
          userId: userId,
        }
      },
      { upsert: true }
    );
  }
  return { totalRairi, totalCost, avgRate };
}

export async function GET(_req: NextRequest, { params }: Params) {
  await connectDB();
  const { id } = await params;
  if (!isValidId(id) && id.length < 10) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let entry = null;
  if (isValidId(id)) entry = await TrolleyEntryModel.findById(id).lean();
  if (!entry) entry = await TrolleyEntryModel.findOne({ localId: id }).lean();

  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: entry, entry });
}

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const { id } = await params;
  const body = await req.json() as UpdateBody;
  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filter = getUserFilter(userId);
  let entryDoc = null;
  if (isValidId(id)) entryDoc = await TrolleyEntryModel.findOne({ _id: id, ...filter });
  if (!entryDoc) entryDoc = await TrolleyEntryModel.findOne({ localId: id, ...filter });
  if (!entryDoc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const oldNormalized = entryDoc.normalizedMaterial;

  if (body.material) {
    entryDoc.material = body.material.trim();
    entryDoc.normalizedMaterial = body.material.trim().toLowerCase();
  }
  if (body.date) entryDoc.date = new Date(body.date);
  if (body.purpose) entryDoc.purpose = body.purpose;

  if (body.rairiInTrolley !== undefined || body.rairiPerTrolley !== undefined) {
    const newActual = rnd(body.rairiInTrolley ?? body.rairiPerTrolley ?? 0);
    if (newActual > 0) {
      entryDoc.actualRairi = newActual;
      entryDoc.rairiInTrolley = newActual;
      entryDoc.rairiRemaining = Math.max(0, newActual - rnd(entryDoc.totalUsed));
      entryDoc.rairiLoss = Math.max(0, FROZEN_RAIRI - newActual);
      // ✅ ASAL RATE
      entryDoc.perRairiRate = Number((entryDoc.trolleyPrice / newActual).toFixed(2));
    }
  }

  if (body.actualRairi !== undefined) {
    const actual = rnd(body.actualRairi);
    entryDoc.actualRairi = actual;
    entryDoc.rairiInTrolley = actual;
    // ✅ ASAL RATE - price / asal
    entryDoc.perRairiRate = Number((entryDoc.trolleyPrice / actual).toFixed(2));
    entryDoc.rairiLoss = Math.max(0, FROZEN_RAIRI - actual);
    entryDoc.rairiRemaining = Math.max(0, actual - rnd(entryDoc.totalUsed));
  }

  if (body.trolleyPrice !== undefined) {
    entryDoc.trolleyPrice = rnd(body.trolleyPrice);
    const actualForRate = rnd(entryDoc.actualRairi || entryDoc.rairiInTrolley || FROZEN_RAIRI);
    // ✅ ASAL RATE
    entryDoc.perRairiRate = Number((entryDoc.trolleyPrice / actualForRate).toFixed(2));
  }

  await entryDoc.save();

  if (oldNormalized !== entryDoc.normalizedMaterial) {
    await recalcStock(userId, oldNormalized);
  }
  const stock = await recalcStock(userId, entryDoc.normalizedMaterial);

  return NextResponse.json({ data: entryDoc, stock, ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const { id } = await params;
  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filter = getUserFilter(userId);
  let entry = null;
  if (isValidId(id)) entry = await TrolleyEntryModel.findOne({ _id: id, ...filter });
  if (!entry) entry = await TrolleyEntryModel.findOne({ localId: id, ...filter });
  if (!entry) return NextResponse.json({ ok: true, message: "Already deleted" });

  const normalized = entry.normalizedMaterial;

  if (rnd(entry.totalUsed) > 0) {
    return NextResponse.json(
      { error: `Cannot delete - ${entry.totalUsed} Rairi already used in daily production` },
      { status: 400 }
    );
  }

  await TrolleyEntryModel.deleteOne({ _id: entry._id });
  const stock = await recalcStock(userId, normalized);

  return NextResponse.json({ ok: true, stock, message: "Trolley deleted, old dailies untouched" });
}