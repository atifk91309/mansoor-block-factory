import connectDB from "@/lib/mongodb";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CloseBody = { 
  localId: string; 
  actualRairi?: number;
  actualQty?: number;
  userId?: string 
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

type UserFilter = { userId: string } | { $or: [{ userId: Types.ObjectId }, { userId: string }] };

function getUserFilter(userId: string): UserFilter {
  if (Types.ObjectId.isValid(userId)) return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  return { userId: userId };
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as CloseBody;
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId missing" }, { status: 400 });
  if (!body.localId) return NextResponse.json({ error: "localId required" }, { status: 400 });

  const actual = rnd(body.actualRairi ?? body.actualQty ?? 0);
  if (actual <= 0) return NextResponse.json({ error: "actualRairi > 0" }, { status: 400 });

  const entry = await TrolleyEntryModel.findOne({ ...getUserFilter(userId), localId: body.localId });
  if (!entry) return NextResponse.json({ error: "Trolley not found" }, { status: 404 });

  if (entry.status === "CLOSED") {
    return NextResponse.json({ ok: true, message: "Already closed", entry });
  }

  const est = rnd(entry.rairiInTrolley);
  const oldRate = Number(Number(entry.perRairiRate || 0).toFixed(2));
  const newRate = Number((entry.trolleyPrice / actual).toFixed(2));
  const rairiLoss = Math.max(0, est - actual);
  const rairiRemaining = Math.max(0, actual - rnd(entry.totalUsed));

  entry.actualRairi = actual;
  entry.perRairiRate = newRate;
  entry.status = "CLOSED";
  entry.rairiLoss = rairiLoss;
  entry.rairiRemaining = rairiRemaining;
  entry.closedAt = new Date();
  await entry.save();

  const allEntries = await TrolleyEntryModel.find({
    ...getUserFilter(userId),
    normalizedMaterial: entry.normalizedMaterial,
  }).lean<TrolleyLean[]>();

  let totalRairi = 0;
  let totalCost = 0;
  for (const e of allEntries) {
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley);
    const remaining = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    if (remaining <= 0) continue;
    const rate = Number(Number(e.perRairiRate ?? 0).toFixed(2));
    totalRairi += remaining;
    totalCost += remaining * rate;
  }
  const avgRate = totalRairi > 0 ? Number((totalCost / totalRairi).toFixed(2)) : 0;

  // ✅ FIX: Write direct userId, no $or
  if (totalRairi <= 0) {
    await TrolleyStockModel.deleteOne({
      userId: userId,
      normalizedMaterial: entry.normalizedMaterial,
    });
  } else {
    await TrolleyStockModel.updateOne(
      { 
        userId: userId,
        normalizedMaterial: entry.normalizedMaterial,
      },
      { 
        $set: { 
          material: entry.material,
          totalRairi: rnd(totalRairi), 
          totalCost: rnd(totalCost), 
          avgRate, 
          updatedAt: new Date() 
        },
        $setOnInsert: { 
          localId: `stock_${entry.normalizedMaterial}_${Date.now()}`,
          normalizedMaterial: entry.normalizedMaterial,
          userId: userId,
        }
      },
      { upsert: true }
    );
  }

  return NextResponse.json({
    ok: true,
    message: `Closed ${est}->${actual} Rairi, rate ${oldRate}->${newRate} Rs, stock updated, old dailies untouched`,
    est,
    actual,
    diff: actual - est,
    oldRate,
    newRate,
    rairiLoss,
    rairiRemaining,
    affectedDailies: 0,
    stock: { totalRairi, totalCost, avgRate },
  });
}