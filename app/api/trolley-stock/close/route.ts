import connectDB from "@/lib/mongodb";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import BlockDaily from "@/models/BlockDaily";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { recalcMonthlyExpense } from "@/lib/calc-monthly";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CloseBody = { localId: string; actualRairi: number; userId?: string };

type MixMaterial = {
  label: string;
  rairi: number;
  amount?: number;
  rate?: number;
  trolleyEntryId?: string;
  toObject?: () => MixMaterial & Record<string, unknown>;
};

type BlockDailyLean = {
  _id: Types.ObjectId;
  mixMaterials: MixMaterial[];
  mixCost?: number;
  totalBill?: number;
  blocksCount: number;
  date: Date;
};

type TrolleyEntryLean = {
  rairiInTrolley: number;
  actualRairi?: number;
  totalUsed?: number;
  perRairiRate?: number;
};

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

function getUserFilter(userId: string): Record<string, unknown> {
  if (Types.ObjectId.isValid(userId)) {
    return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  }
  return { userId: userId };
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as CloseBody;
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId missing" }, { status: 400 });
  if (!body.localId) return NextResponse.json({ error: "localId required" }, { status: 400 });

  const actual = rnd(body.actualRairi);
  if (actual <= 0) return NextResponse.json({ error: "actualRairi > 0" }, { status: 400 });

  const entry = await TrolleyEntryModel.findOne({ ...getUserFilter(userId), localId: body.localId });
  if (!entry) return NextResponse.json({ error: "Trolley not found" }, { status: 404 });

  const est = rnd(entry.rairiInTrolley);
  const newRate = Number((entry.trolleyPrice / actual).toFixed(2));
  const oldRate = entry.perRairiRate;

  entry.actualRairi = actual;
  entry.perRairiRate = newRate;
  entry.status = "CLOSED";
  await entry.save();

  // Stock recalc from all entries
  const allEntries = (await TrolleyEntryModel.find({
    ...getUserFilter(userId),
    normalizedMaterial: entry.normalizedMaterial,
  }).lean()) as unknown as TrolleyEntryLean[];

  let totalRairi = 0;
  let totalCost = 0;
  for (const e of allEntries) {
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley);
    const remaining = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    totalRairi += remaining;
    totalCost += remaining * Number(e.perRairiRate ?? 0);
  }
  const avgRate = totalRairi > 0 ? Number((totalCost / totalRairi).toFixed(2)) : 0;

  await TrolleyStockModel.updateOne(
    { ...getUserFilter(userId), normalizedMaterial: entry.normalizedMaterial },
    { $set: { totalRairi: rnd(totalRairi), totalCost: rnd(totalCost), avgRate, updatedAt: new Date() } },
    { upsert: true }
  );

  // Force recalc all dailies by label - fixes 14.27
  const allDailies = (await BlockDaily.find({ ...getUserFilter(userId) })
    .sort({ date: -1 })
    .limit(300)
    .lean()) as unknown as BlockDailyLean[];

  let affected = 0;
  const affectedMonths = new Set<string>();

  for (const daily of allDailies) {
    let hasMatch = false;
    let newMixCost = 0;

    const updatedMix = daily.mixMaterials.map((m) => {
      const labelNorm = String(m.label || "").toLowerCase().trim();
      const idMatch = m.trolleyEntryId === body.localId;
      const labelMatch = labelNorm === entry.normalizedMaterial;
      const isMatch = idMatch || labelMatch;

      if (isMatch) {
        hasMatch = true;
        const amt = rnd(m.rairi * newRate);
        newMixCost += amt;
        const raw = m.toObject ? m.toObject() : { ...m };
        return { ...raw, rate: newRate, amount: amt, trolleyEntryId: body.localId };
      }
      newMixCost += rnd(m.amount ?? 0);
      return m;
    });

    if (!hasMatch) continue;
    if (rnd(daily.mixCost ?? 0) === newMixCost) continue;

    const newTotalBill = rnd((daily.totalBill ?? 0) + (newMixCost - rnd(daily.mixCost ?? 0)));
    const newCostPerBlock = daily.blocksCount > 0 ? Number((newTotalBill / daily.blocksCount).toFixed(2)) : 0;

    await BlockDaily.updateOne(
      { _id: daily._id },
      { $set: { mixMaterials: updatedMix, mixCost: newMixCost, totalBill: newTotalBill, costPerBlock: newCostPerBlock } }
    );
    affected++;
    const d = new Date(daily.date);
    affectedMonths.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  for (const mm of affectedMonths) {
    try {
      await recalcMonthlyExpense(userId, mm);
    } catch {
      // ignore recalc error
    }
  }

  return NextResponse.json({
    ok: true,
    message: `Closed ${est}->${actual} Rairi, rate ${oldRate}->${newRate} Rs, ${affected} dailies recalculated`,
    diff: actual - est,
    oldRate,
    newRate,
    affectedDailies: affected,
    affectedMonths: Array.from(affectedMonths),
    stock: { totalRairi, totalCost, avgRate },
  });
}