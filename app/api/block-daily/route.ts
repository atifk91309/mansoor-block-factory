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

function getUserFilter(userId: string) {
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
      map.set(norm, { ...m, qty: m.qty || `${m.rairi} ریڑھی`, rate: Number((m.rate || 0).toFixed(2)) });
    }
  }
  return Array.from(map.values());
}

async function recalcAllStocks(userId: string): Promise<void> {
  const all = await TrolleyEntryModel.find({ 
    ...getUserFilter(userId)
  }).lean();
  
  const map = new Map<string, { rairi: number; cost: number }>();
  for (const e of all) {
    const norm = String(e.normalizedMaterial || "").toLowerCase().trim();
    if (!norm) continue;
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley ?? 0);
    const rem = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    if (rem <= 0) continue;
    const cur = map.get(norm) ?? { rairi: 0, cost: 0 };
    const rate = Number((e.perRairiRate || 0).toFixed(2));
    cur.rairi += rem;
    cur.cost += rem * rate;
    map.set(norm, cur);
  }
  
  for (const [norm, v] of map) {
    const avg = v.rairi > 0 ? Number((v.cost / v.rairi).toFixed(2)) : 0;
    const matName = all.find((e) => String(e.normalizedMaterial || "").toLowerCase().trim() === norm)?.material || norm;
    await TrolleyStockModel.updateOne(
      { ...getUserFilter(userId), normalizedMaterial: norm },
      {
        $set: { 
          material: matName, 
          totalRairi: rnd(v.rairi), 
          totalCost: rnd(v.cost), 
          avgRate: avg, 
          updatedAt: new Date()
        },
        $setOnInsert: { 
          localId: `stock_${norm}_${Date.now()}`,
          normalizedMaterial: norm,
        }
      },
      { upsert: true }
    );
  }

  const allStocks = await TrolleyStockModel.find({ ...getUserFilter(userId) }).lean();
  const zeroNorms = allStocks.filter(s => (s.totalRairi || 0) <= 0).map(s => s.normalizedMaterial);
  if (zeroNorms.length > 0) {
    await TrolleyStockModel.deleteMany({ ...getUserFilter(userId), normalizedMaterial: { $in: zeroNorms } });
  }
  const existingNorms = allStocks.map(s => s.normalizedMaterial);
  const toDelete = existingNorms.filter(n => !map.has(n));
  if (toDelete.length > 0) {
    await TrolleyStockModel.deleteMany({ ...getUserFilter(userId), normalizedMaterial: { $in: toDelete } });
  }
}

export async function GET(req: NextRequest) {
  await connectDB();
  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId" }, { status: 400 });
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const baseFilter = getUserFilter(userId);
  const dateFilter = from && to ? { date: { $gte: new Date(from), $lte: new Date(to) } } : {};
  const data = await BlockDaily.find({ ...baseFilter, ...dateFilter }).sort({ date: -1 }).limit(500).lean();
  return NextResponse.json({ data, blockDailies: data });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = await req.json() as BlockDailyBody;
  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId" }, { status: 400 });
  if (!body.blocksMade?.trim()) return NextResponse.json({ error: "blocksMade name required" }, { status: 400 });

  const batchId = body.batchId;
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
      // ✅ ASAL RATE - client se jo 309.09 aaya usi se
      const ratePerRairi = Number((m.rate || 0).toFixed(2));
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
    const ll = b.label.toLowerCase();
    if (ll.includes("labour") || b.label.includes("مزدوری") || ll.includes("mazdoor")) return sum;
    if (body.isMonthlyElectricity && (ll.includes("electric") || b.label.includes("بجلی"))) return sum;
    return sum + (b.amount || 0);
  }, 0);
  
  const trolleyMixCost = cleanMix.reduce((s, m) => s + (m.amount || 0), 0);
  const mixCost = trolleyMixCost + cementCost;
  const totalBill = body.totalBill !== undefined ? rnd(body.totalBill) : rnd(wages + extraBills + mixCost);
  const dailyDate = body.date ? new Date(body.date) : new Date();

  const daily = await BlockDaily.create({
    date: dailyDate, 
    cementBags, cementRate, cementCost,
    blocksMade: name, blocksCount: count,
    dailyWages: wages, mazdoorRatePerBlock: mazdoorRate, ratePerBlock: mazdoorRate, labourCost: labourCost,
    blockType: body.blockType || "6 inch", userId, batchId,
    bills: cleanBills, mixMaterials: cleanMix, 
    trolleyMixCost, mixCost, totalBill,
    costPerBlock: count > 0 ? Number((totalBill / count).toFixed(2)) : 0,
    isMonthlyElectricity: body.isMonthlyElectricity || false, 
    localId: body.localId || `daily_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
  });

    for (const mix of cleanMix) {
    if (mix.rairi <= 0) continue;
    const normalized = mix.label.toLowerCase().trim();
    let deducted = false;

    if (mix.trolleyEntryId) {
      const updated = await TrolleyEntryModel.findOneAndUpdate(
        { 
          ...getUserFilter(userId), 
          localId: mix.trolleyEntryId,
          // status hatao — CLOSED pe bhi deduct hona chahiye
        },
        { $inc: { totalUsed: mix.rairi } }
      );
      if (updated) deducted = true;
    }
    
    if (!deducted) {
      // ✅ CLOSED + OPEN dono me se sab se purana jisme stock bacha ho
      const allForMat = await TrolleyEntryModel.find({
        ...getUserFilter(userId), 
        normalizedMaterial: normalized,
      }).sort({ date: 1 }).lean();
      
      let need = mix.rairi;
      for (const ent of allForMat) {
        if (need <= 0) break;
        const eff = rnd(ent.actualRairi ?? ent.rairiInTrolley ?? 0);
        const rem = Math.max(0, eff - rnd(ent.totalUsed ?? 0));
        if (rem <= 0) continue;
        const use = Math.min(rem, need);
        await TrolleyEntryModel.updateOne({ _id: ent._id }, { $inc: { totalUsed: use } });
        need -= use;
        deducted = true;
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