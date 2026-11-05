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

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

function getUserFilter(userId: string) {
  if (Types.ObjectId.isValid(userId)) {
    return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  }
  return { userId: userId };
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await req.json() as CloseBody;
  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId missing" }, { status: 400 });
  if (!body.localId) return NextResponse.json({ error: "localId required" }, { status: 400 });

  const actual = rnd(body.actualRairi ?? body.actualQty ?? 0);
  if (actual <= 0) return NextResponse.json({ error: "actualRairi > 0" }, { status: 400 });

  const entry = await TrolleyEntryModel.findOne({ ...getUserFilter(userId), localId: body.localId });
  if (!entry) return NextResponse.json({ error: "Trolley not found" }, { status: 404 });

  if (entry.status === "CLOSED") {
    return NextResponse.json({ ok: true, message: "Already closed" });
  }

  const est = rnd(entry.rairiInTrolley || 60);
  const oldRate = Number((entry.perRairiRate || 0).toFixed(2));
  
  // ✅ ASAL HISAB - price / asal rairi
  const realRate = Number((entry.trolleyPrice / actual).toFixed(2));
  const used = rnd(entry.totalUsed || 0);
  const remaining = Math.max(0, actual - used);
  const rairiLoss = Math.max(0, est - actual);

  entry.actualRairi = actual;
  entry.perRairiRate = realRate;
  entry.status = "CLOSED";
  entry.rairiLoss = rairiLoss;
  entry.rairiRemaining = remaining;
  entry.closedAt = new Date();
  await entry.save();

  // Stock recalc - asal rate se
  const allEntries = await TrolleyEntryModel.find({
    ...getUserFilter(userId),
    normalizedMaterial: entry.normalizedMaterial,
  }).lean();

  let totalRairi = 0;
  let totalCost = 0;
  for (const e of allEntries) {
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley ?? 0);
    const rem = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    if (rem <= 0) continue;
    const rate = Number((e.perRairiRate || 0).toFixed(2));
    totalRairi += rem;
    totalCost += rem * rate;
  }
  const avgRate = totalRairi > 0 ? Number((totalCost / totalRairi).toFixed(2)) : 0;

  if (totalRairi <= 0) {
    // ✅ FIX: getUserFilter use karo taake purana 60 wala doc delete ho
    await TrolleyStockModel.deleteOne({
      ...getUserFilter(userId),
      normalizedMaterial: entry.normalizedMaterial,
    });
  } else {
    await TrolleyStockModel.updateOne(
      { 
        ...getUserFilter(userId),
        normalizedMaterial: entry.normalizedMaterial,
      },
      { 
        $set: { 
          material: entry.material,
          totalRairi: rnd(totalRairi), 
          totalCost: Math.round(totalCost), 
          avgRate, 
          updatedAt: new Date() 
        },
        $setOnInsert: { 
          localId: `stock_${entry.normalizedMaterial}_${Date.now()}`,
          normalizedMaterial: entry.normalizedMaterial,
          userId: entry.userId, // ✅ entry ka userId taake type same rahe
        }
      },
      { upsert: true }
    );
  }

  return NextResponse.json({
    ok: true,
    message: `Closed ${est}->${actual} Rairi, rate ${oldRate}->${realRate} Rs (asal hisab)`,
    est,
    actual,
    diff: actual - est,
    oldRate,
    newRate: realRate,
    rairiLoss,
    rairiRemaining: remaining,
    stock: { totalRairi, totalCost, avgRate },
  });
}