import connectDB from "@/lib/mongodb";
import BlockDaily from "@/models/BlockDaily";
import BlockProduct from "@/models/BlockProduct";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { recalcMonthlyExpense } from "@/lib/calc-monthly";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BillBody = { label: string; amount: number };
type MixBody = { label: string; qty?: string; rairi: number; rate: number; amount?: number; trolleyEntryId?: string; batchId?: string };
type MixForRevert = { rairi?: number; label?: string; trolleyEntryId?: string };
type SessionUser = { user?: { id?: string } };

function rnd(n: number): number { return Math.round(Number(n) || 0); }

function getUserFilter(userId: string) {
  if (Types.ObjectId.isValid(userId)) {
    return { userId: { $in: [new Types.ObjectId(userId), userId] } };
  }
  return { userId: userId };
}

async function recalcAllStocks(userId: string): Promise<void> {
  const userFilter = getUserFilter(userId);
  const allEntries = await TrolleyEntryModel.find(userFilter).lean();
  
  const map = new Map<string, { rairi: number; cost: number }>();
  for (const e of allEntries) {
    const norm = String((e as { normalizedMaterial?: string }).normalizedMaterial || "").toLowerCase().trim();
    if (!norm) continue;
    const eff = rnd((e as { actualRairi?: number }).actualRairi ?? (e as { rairiInTrolley?: number }).rairiInTrolley ?? 0);
    const rem = Math.max(0, eff - rnd((e as { totalUsed?: number }).totalUsed ?? 0));
    if (rem <= 0) continue;
    const cur = map.get(norm) ?? { rairi: 0, cost: 0 };
    const rate = Number(((e as { perRairiRate?: number }).perRairiRate || 0).toFixed(2));
    cur.rairi += rem;
    cur.cost += rem * rate;
    map.set(norm, cur);
  }
  for (const [norm, v] of map) {
    const avg = v.rairi > 0 ? Number((v.cost / v.rairi).toFixed(2)) : 0;
    const matName = allEntries.find((en) => String((en as { normalizedMaterial?: string }).normalizedMaterial || "").toLowerCase().trim() === norm)?.material || norm;
    await TrolleyStockModel.updateOne(
      { ...userFilter, normalizedMaterial: norm },
      { 
        $set: { material: matName, totalRairi: rnd(v.rairi), totalCost: rnd(v.cost), avgRate: avg, updatedAt: new Date() },
        $setOnInsert: { localId: `stock_${norm}_${Date.now()}`, userId: userId }
      },
      { upsert: true }
    );
  }
  const allStocks = await TrolleyStockModel.find(userFilter).lean();
  const existingNorms = allStocks.map(s => s.normalizedMaterial);
  const toDelete = existingNorms.filter(n => !map.has(n));
  if (toDelete.length > 0) {
    await TrolleyStockModel.deleteMany({ ...userFilter, normalizedMaterial: { $in: toDelete } });
  }
}

async function revertTrolleyUsage(userId: string, mixes: MixForRevert[]): Promise<void> {
  const userFilter = getUserFilter(userId);
  for (const m of mixes) {
    const rairi = rnd(m.rairi || 0);
    if (rairi <= 0) continue;
    if (m.trolleyEntryId) {
      const entry = await TrolleyEntryModel.findOne({ ...userFilter, localId: m.trolleyEntryId });
      if (entry) {
        const newUsed = Math.max(0, rnd((entry as { totalUsed?: number }).totalUsed ?? 0) - rairi);
        await TrolleyEntryModel.updateOne({ _id: entry._id }, { $set: { totalUsed: newUsed } });
        continue;
      }
    }
    const label = (m.label || "").toLowerCase().trim();
    if (!label) continue;
    const lastUsed = await TrolleyEntryModel.findOne({ 
      ...userFilter, normalizedMaterial: label, totalUsed: { $gte: 1 } 
    }).sort({ updatedAt: -1 });
    if (lastUsed) {
      const newUsed = Math.max(0, rnd((lastUsed as { totalUsed?: number }).totalUsed ?? 0) - rairi);
      await TrolleyEntryModel.updateOne({ _id: lastUsed._id }, { $set: { totalUsed: newUsed } });
    }
  }
  await recalcAllStocks(userId);
}

async function applyTrolleyUsage(userId: string, mixes: MixBody[]): Promise<void> {
  const userFilter = getUserFilter(userId);
  for (const mix of mixes) {
    const rairi = rnd(mix.rairi || 0);
    if (rairi <= 0) continue;
    const normalized = mix.label.toLowerCase().trim();
    let deducted = false;

    if (mix.trolleyEntryId) {
      const updated = await TrolleyEntryModel.findOneAndUpdate(
        { ...userFilter, localId: mix.trolleyEntryId },
        { $inc: { totalUsed: rairi } }
      );
      if (updated) deducted = true;
    }

    if (!deducted) {
      const allForMat = await TrolleyEntryModel.find({
        ...userFilter,
        normalizedMaterial: normalized,
      }).sort({ date: 1 }).lean();

      let need = rairi;
      for (const ent of allForMat) {
        if (need <= 0) break;
        const eff = rnd((ent as { actualRairi?: number }).actualRairi ?? (ent as { rairiInTrolley?: number }).rairiInTrolley ?? 0);
        const rem = Math.max(0, eff - rnd((ent as { totalUsed?: number }).totalUsed ?? 0));
        if (rem <= 0) continue;
        const use = Math.min(rem, need);
        await TrolleyEntryModel.updateOne({ _id: ent._id }, { $inc: { totalUsed: use } });
        need -= use;
      }
    }
  }
  await recalcAllStocks(userId);
} 

function mergeSameMaterial(mixes: MixBody[]): MixBody[] {
  const map = new Map<string, MixBody>();
  for (const m of mixes) {
    const norm = m.label.toLowerCase().trim();
    const existing = map.get(norm);
    if (existing) {
      existing.rairi = rnd(existing.rairi + m.rairi);
      existing.amount = rnd((existing.amount ?? 0) + (m.amount ?? 0));
      existing.qty = `${existing.rairi} ریڑھی`;
    } else {
      map.set(norm, { ...m, qty: m.qty || `${m.rairi} ریڑھی`, rate: Number((m.rate || 0).toFixed(2)) });
    }
  }
  return Array.from(map.values());
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions) as SessionUser | null;
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userFilter = getUserFilter(session.user.id);
    const daily = await BlockDaily.findOne({ _id: id, ...userFilter }).lean();
    if (!daily) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(daily);
  } catch { return NextResponse.json({ error: "Failed" }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions) as SessionUser | null;
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const userFilter = getUserFilter(userId);
    const daily = await BlockDaily.findOne({ _id: id, ...userFilter }).lean();
    if (!daily) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const existing = await BlockProduct.findOne({
      ...userFilter,
      name: { $regex: `^${daily.blocksMade.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
    if (existing) {
      const newStock = Math.max(0, rnd(existing.stock) - rnd(daily.blocksCount));
      await BlockProduct.updateOne({ _id: existing._id }, { $set: { stock: newStock } });
    }

    await revertTrolleyUsage(userId, daily.mixMaterials || []);
    await BlockDaily.deleteOne({ _id: id });

    const d = daily.date ? new Date(daily.date) : new Date();
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    await recalcMonthlyExpense(userId, monthStr);

    return NextResponse.json({ ok: true, message: "Deleted and Used reverted" });
  } catch (e) { console.error(e); return NextResponse.json({ error: "Delete failed" }, { status: 500 }); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions) as SessionUser | null;
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const userFilter = getUserFilter(userId);
    const body = await req.json() as {
      blocksMade?: string; blocksCount?: number; cementBags?: number; cementRate?: number; cementCost?: number;
      mazdoorRatePerBlock?: number; ratePerBlock?: number; blockType?: string; date?: string;
      bills?: BillBody[]; mixMaterials?: MixBody[]; isMonthlyElectricity?: boolean; batchId?: string;
    };
    const old = await BlockDaily.findOne({ _id: id, ...userFilter }).lean();
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const newCount = rnd(body.blocksCount ?? old.blocksCount);
    const newName = body.blocksMade?.trim() || old.blocksMade;
    const diff = newCount - rnd(old.blocksCount);
    const isNameChanged = newName.toLowerCase() !== old.blocksMade.toLowerCase();
    
    const mazdoorRate = rnd(body.mazdoorRatePerBlock ?? body.ratePerBlock ?? old.mazdoorRatePerBlock ?? old.ratePerBlock ?? 3);
    const cementBags = rnd(body.cementBags ?? old.cementBags ?? 0);
    const cementRate = rnd(body.cementRate ?? old.cementRate ?? 1400);
    const cementCost = rnd(body.cementCost ?? cementBags * cementRate);

    const cleanBills: BillBody[] = (body.bills ?? old.bills ?? []).filter((b) => b.label?.trim()).map((b) => ({ label: b.label.trim(), amount: rnd(b.amount || 0) }));
    
    let cleanMix: MixBody[] = (body.mixMaterials ?? old.mixMaterials ?? []).filter((m) => m.label?.trim() && (m.rairi || 0) > 0).map((m) => ({
      label: m.label.trim(), 
      qty: m.qty?.trim() || `${rnd(m.rairi || 0)} ریڑھی`, 
      rairi: rnd(m.rairi || 0), 
      rate: Number((m.rate || 0).toFixed(2)),
      amount: rnd(m.amount || rnd(m.rairi || 0) * Number((m.rate || 0).toFixed(2))), 
      trolleyEntryId: m.trolleyEntryId?.trim(), 
      batchId: m.batchId
    }));
    cleanMix = mergeSameMaterial(cleanMix);

    const extraBills = cleanBills.reduce((sum, b) => {
      const ll = b.label.toLowerCase();
      if (ll.includes("labour") || b.label.includes("مزدوری") || ll.includes("mazdoor")) return sum;
      if ((body.isMonthlyElectricity ?? old.isMonthlyElectricity) && (ll.includes("electric") || b.label.includes("بجلی"))) return sum;
      return sum + (b.amount || 0);
    }, 0);
    const trolleyMixCost = cleanMix.reduce((s, m) => s + (m.amount || 0), 0);
    const mixCost = trolleyMixCost + cementCost;
    const labourCost = rnd(newCount * mazdoorRate);
    const totalBill = labourCost + extraBills + mixCost;

    await revertTrolleyUsage(userId, old.mixMaterials || []);

    const updated = await BlockDaily.findOneAndUpdate(
      { _id: id, ...userFilter },
      {
        blocksMade: newName, blocksCount: newCount, 
        cementBags, cementRate, cementCost,
        mazdoorRatePerBlock: mazdoorRate, ratePerBlock: mazdoorRate, labourCost,
        dailyWages: labourCost, blockType: body.blockType || old.blockType || "6 inch",
        date: body.date ? new Date(body.date) : old.date, 
        bills: cleanBills, mixMaterials: cleanMix, 
        trolleyMixCost, mixCost, totalBill,
        costPerBlock: newCount > 0 ? Number((totalBill / newCount).toFixed(2)) : 0,
        isMonthlyElectricity: body.isMonthlyElectricity ?? old.isMonthlyElectricity ?? false,
        batchId: body.batchId || old.batchId,
      },
      { new: true }
    );

    await applyTrolleyUsage(userId, cleanMix);

    if (isNameChanged) {
      const oldProd = await BlockProduct.findOne({ ...userFilter, name: { $regex: `^${old.blocksMade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
      const newProd = await BlockProduct.findOne({ ...userFilter, name: { $regex: `^${newName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
      if (oldProd) await BlockProduct.updateOne({ _id: oldProd._id }, { $inc: { stock: -rnd(old.blocksCount) } });
      if (newProd) await BlockProduct.updateOne({ _id: newProd._id }, { $inc: { stock: newCount } });
    } else if (diff !== 0) {
      const prod = await BlockProduct.findOne({ ...userFilter, name: { $regex: `^${old.blocksMade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
      if (prod) await BlockProduct.updateOne({ _id: prod._id }, { $inc: { stock: diff } });
    }

    const d = updated?.date ? new Date(updated.date) : new Date(old.date);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    await recalcMonthlyExpense(userId, monthStr);

    return NextResponse.json(updated);
  } catch (e) { console.error(e); return NextResponse.json({ error: "Update failed" }, { status: 500 }); }
}