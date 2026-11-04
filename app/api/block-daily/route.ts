import connectDB from "@/lib/mongodb";
import BlockDaily from "@/models/BlockDaily";
import BlockProduct from "@/models/BlockProduct";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { recalcMonthlyExpense } from "@/lib/calc-monthly";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BillBody = { label: string; amount: number };
type MixBody = { 
  label: string; qty?: string; rairi: number; rate: number; 
  amount?: number; trolleyEntryId?: string; batchId?: string;
};
type BlockDailyBody = {
  localId?: string; userId?: string; date?: string; 
  cementBags?: number; cementRate?: number; cementCost?: number;
  blocksMade?: string; blocksCount?: number; 
  dailyWages?: number; mazdoorRatePerBlock?: number; ratePerBlock?: number; 
  labourCost?: number; blockType?: string; batchId?: string;
  bills?: BillBody[]; mixMaterials?: MixBody[]; 
  trolleyMixCost?: number; mixCost?: number; totalBill?: number;
  isMonthlyElectricity?: boolean;
};

function rnd(n: number): number { return Math.round(Number(n) || 0); }

function getUserFilter(userId: string): Record<string, unknown> {
  if (Types.ObjectId.isValid(userId)) {
    return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  }
  return { userId: userId };
}

function mergeSameMaterial(mixes: MixBody[]): MixBody[] {
  const map = new Map<string, MixBody>();
  for (const m of mixes) {
    const norm = m.label.toLowerCase().trim();
    const exist = map.get(norm);
    if (exist) {
      exist.rairi = rnd(exist.rairi + m.rairi);
      exist.amount = rnd((exist.amount ?? 0) + (m.amount ?? 0));
      exist.qty = `${exist.rairi} ریڑھی`;
    } else {
      map.set(norm, { ...m, qty: m.qty || `${m.rairi} ریڑھی` });
    }
  }
  return Array.from(map.values());
}

async function recalcAllStocks(userId: string): Promise<void> {
  const all = await TrolleyEntryModel.find({ 
    ...getUserFilter(userId)
  }).lean() as unknown as Array<{
    material: string; normalizedMaterial: string;
    rairiInTrolley: number; actualRairi?: number;
    totalUsed?: number; perRairiRate?: number;
  }>;
  
  const map = new Map<string, { rairi: number; cost: number }>();
  for (const e of all) {
    const norm = String(e.normalizedMaterial || "").toLowerCase().trim();
    if (!norm) continue;
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley);
    const rem = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    const cur = map.get(norm) ?? { rairi: 0, cost: 0 };
    cur.rairi += rem;
    cur.cost += rem * Number(e.perRairiRate ?? 0);
    map.set(norm, cur);
  }
  
  for (const [norm, v] of map) {
    const avg = v.rairi > 0 ? Number((v.cost / v.rairi).toFixed(2)) : 0;
    const matName = all.find((e) => String(e.normalizedMaterial || "").toLowerCase().trim() === norm)?.material || norm;
    await TrolleyStockModel.updateOne(
      { ...getUserFilter(userId), normalizedMaterial: norm },
      {
        $set: { 
          material: matName, totalRairi: rnd(v.rairi), 
          totalCost: rnd(v.cost), avgRate: avg, updatedAt: new Date()
        },
        $setOnInsert: { localId: `stock_${norm}`, userId },
      },
      { upsert: true }
    );
  }
}

export async function GET(req: NextRequest) {
  await connectDB();
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId" }, { status: 400 });
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const baseFilter = getUserFilter(userId);
  const dateFilter: Record<string, unknown> = from && to ? { date: { $gte: new Date(from), $lte: new Date(to) } } : {};
  // NO batchId filter - show all
  const data = await BlockDaily.find({ ...baseFilter, ...dateFilter }).sort({ date: -1 }).limit(500).lean();
  return NextResponse.json({ data, blockDailies: data });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as BlockDailyBody;
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId" }, { status: 400 });
  if (!body.blocksMade?.trim()) return NextResponse.json({ error: "blocksMade name required" }, { status: 400 });

  const batchId = body.batchId; // OPTIONAL
  const mazdoorRate = rnd(body.mazdoorRatePerBlock || body.ratePerBlock || 3);
  const count = rnd(body.blocksCount || 0);
  if (count <= 0) return NextResponse.json({ error: "blocksCount > 0 required" }, { status: 400 });

  const cementBags = rnd(body.cementBags || 0);
  const cementRate = rnd(body.cementRate || 1400);
  const cementCost = rnd(body.cementCost || cementBags * cementRate);
  
  const labourCost = rnd(body.labourCost || body.dailyWages || count * mazdoorRate);
  const wages = labourCost;
  const name = body.blocksMade.trim();

  const cleanBills = (body.bills || []).filter((b) => b.label?.trim()).map((b) => ({ 
    label: b.label.trim(), amount: rnd(b.amount || 0) 
  }));

  let cleanMix: MixBody[] = (body.mixMaterials || [])
    .filter((m) => m.label?.trim() && (m.rairi || 0) > 0)
    .map((m): MixBody => {
      const rairi = rnd(m.rairi || 0);
      const ratePerRairi = rnd(m.rate || 0);
      return {
        label: m.label.trim(),
        qty: m.qty?.trim() || `${rairi} ریڑھی`,
        rairi,
        rate: ratePerRairi,
        amount: rnd(m.amount || rairi * ratePerRairi),
        trolleyEntryId: m.trolleyEntryId?.trim(),
        batchId: m.batchId || batchId,
      };
    });
  cleanMix = mergeSameMaterial(cleanMix);

  const extraBills = cleanBills.reduce((sum, b) => {
    if (b.label.toLowerCase().includes("labour")) return sum;
    if (body.isMonthlyElectricity && (b.label.toLowerCase().includes("electric") || b.label.includes("بجلی"))) return sum;
    return sum + (b.amount || 0);
  }, 0);
  
  const trolleyMixCost = cleanMix.reduce((s, m) => s + (m.amount || 0), 0);
  const mixCost = trolleyMixCost + cementCost;
  const totalBill = body.totalBill !== undefined ? rnd(body.totalBill) : wages + extraBills + mixCost;
  const dailyDate = body.date ? new Date(body.date) : new Date();

  const daily = await BlockDaily.create({
    date: dailyDate, 
    cementBags, cementRate, cementCost,
    blocksMade: name, blocksCount: count,
    dailyWages: wages, mazdoorRatePerBlock: mazdoorRate, ratePerBlock: mazdoorRate, labourCost: labourCost,
    blockType: body.blockType || "6 inch", userId, batchId,
    bills: cleanBills, mixMaterials: cleanMix, 
    trolleyMixCost, mixCost, totalBill,
    costPerBlock: count > 0 ? Math.round((totalBill / count) * 100) / 100 : 0,
    isMonthlyElectricity: body.isMonthlyElectricity || false, 
    localId: body.localId,
  });

  // DEDUCT USED - No batch filter, FIFO by date - Maneray 60 / Ghata 55
  for (const mix of cleanMix) {
    if (mix.rairi <= 0) continue;
    const normalized = mix.label.toLowerCase().trim();
    let deducted = false;

    if (mix.trolleyEntryId) {
      const updated = await TrolleyEntryModel.findOneAndUpdate(
        { ...getUserFilter(userId), localId: mix.trolleyEntryId },
        { $inc: { totalUsed: mix.rairi } }
      );
      if (updated) deducted = true;
    }
    
    if (!deducted) {
      const oldestOpen = await TrolleyEntryModel.findOne({
        ...getUserFilter(userId), normalizedMaterial: normalized, status: "OPEN",
      }).sort({ date: 1 });
      if (oldestOpen) {
        await TrolleyEntryModel.updateOne({ _id: oldestOpen._id }, { $inc: { totalUsed: mix.rairi } });
      }
    }
  }
  await recalcAllStocks(userId);

  const monthStr = `${dailyDate.getFullYear()}-${String(dailyDate.getMonth() + 1).padStart(2, "0")}`;
  await recalcMonthlyExpense(userId, monthStr);

  const existing = await BlockProduct.findOne({
    userId, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (existing) {
    await BlockProduct.updateOne(
      { _id: existing._id },
      { $inc: { stock: count }, $set: { lastPurchaseDate: daily.date } }
    );
  }

  return NextResponse.json(daily);
}