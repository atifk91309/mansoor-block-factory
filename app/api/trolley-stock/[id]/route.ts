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

interface TrolleyLean {
  actualRairi?: number;
  rairiInTrolley: number;
  totalUsed?: number;
  perRairiRate?: number;
}

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}
function isValidId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

type UserFilter = { userId: string } | { $or: [{ userId: Types.ObjectId }, { userId: string }] };

function getUserFilter(userId: string): UserFilter {
  if (Types.ObjectId.isValid(userId)) return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  return { userId: userId };
}

function getRairiForMaterial(name: string): number {
  const nm = name.toLowerCase().trim();
  if (nm.includes("گھٹہ") || nm.includes("شگہ") || nm.includes("ghata") || nm.includes("shaga")) return 55;
  return 60;
}

async function recalcStock(userId: string, normalizedMaterial: string) {
  const all = await TrolleyEntryModel.find({
    ...getUserFilter(userId),
    normalizedMaterial: normalizedMaterial,
  }).lean<TrolleyLean[]>();

  let totalRairi = 0;
  let totalCost = 0;
  for (const e of all) {
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley);
    const remaining = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    if (remaining <= 0) continue;
    const rate = Number(Number(e.perRairiRate || 0).toFixed(2)); // ✅ fix 263.157 -> 263.16
    totalRairi += remaining;
    totalCost += remaining * rate;
  }
  const avgRate = totalRairi > 0 ? Number((totalCost / totalRairi).toFixed(2)) : 0;

  // ✅ FIX: direct userId for write
  if (totalRairi <= 0) {
    await TrolleyStockModel.deleteOne({
      userId: userId,
      normalizedMaterial: normalizedMaterial,
    });
  } else {
    await TrolleyStockModel.updateOne(
      { userId: userId, normalizedMaterial: normalizedMaterial },
      { 
        $set: { totalRairi: rnd(totalRairi), totalCost: rnd(totalCost), avgRate, updatedAt: new Date() },
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

  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
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
  const body = (await req.json()) as UpdateBody;
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filter = getUserFilter(userId);
  let entry = null;
  if (isValidId(id)) entry = await TrolleyEntryModel.findOne({ _id: id, ...filter });
  if (!entry) entry = await TrolleyEntryModel.findOne({ localId: id, ...filter });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const oldNormalized = entry.normalizedMaterial;

  if (body.material) {
    entry.material = body.material.trim();
    entry.normalizedMaterial = body.material.trim().toLowerCase();
  }
  if (body.date) entry.date = new Date(body.date);
  if (body.purpose) entry.purpose = body.purpose;

  if (body.rairiInTrolley !== undefined || body.rairiPerTrolley !== undefined) {
    const newRairi = rnd(body.rairiInTrolley ?? body.rairiPerTrolley ?? getRairiForMaterial(entry.material));
    entry.rairiInTrolley = newRairi;
    if (entry.status === "OPEN") {
      entry.actualRairi = newRairi;
      entry.rairiRemaining = Math.max(0, newRairi - rnd(entry.totalUsed));
    }
  }
  if (body.actualRairi !== undefined) {
    const actual = rnd(body.actualRairi);
    const est = rnd(entry.rairiInTrolley);
    entry.actualRairi = actual;
    entry.perRairiRate = Number((entry.trolleyPrice / actual).toFixed(2));
    entry.rairiLoss = Math.max(0, est - actual);
    entry.rairiRemaining = Math.max(0, actual - rnd(entry.totalUsed));
  }
  if (body.trolleyPrice !== undefined) {
    entry.trolleyPrice = rnd(body.trolleyPrice);
    const eff = rnd(entry.actualRairi ?? entry.rairiInTrolley);
    if (eff > 0) entry.perRairiRate = Number((entry.trolleyPrice / eff).toFixed(2));
  }

  await entry.save();

  if (oldNormalized !== entry.normalizedMaterial) {
    await recalcStock(userId, oldNormalized);
  }
  const stock = await recalcStock(userId, entry.normalizedMaterial);

  return NextResponse.json({ data: entry, stock, ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDB();
  const { id } = await params;
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
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