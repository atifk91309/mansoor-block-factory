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
type MixBody = { label: string; qty?: string; rairi: number; rate: number; amount?: number; trolleyEntryId?: string };
type MixForRevert = { rairi?: number; label?: string; trolleyEntryId?: string };

function rnd(n: number): number { return Math.round(Number(n) || 0); }
function getUserFilter(userId: string): Record<string, unknown> {
  if (Types.ObjectId.isValid(userId)) return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  return { userId: userId };
}

async function revertTrolleyUsage(userId: string, mixes: MixForRevert[]): Promise<void> {
  for (const m of mixes) {
    const rairi = rnd(m.rairi || 0);
    if (rairi <= 0) continue;
    const label = (m.label || "").toLowerCase().trim();
    if (m.trolleyEntryId) {
      await TrolleyEntryModel.findOneAndUpdate({ ...getUserFilter(userId), localId: m.trolleyEntryId }, { $inc: { totalUsed: -rairi } });
      const entry = await TrolleyEntryModel.findOne({ ...getUserFilter(userId), localId: m.trolleyEntryId }).lean() as { normalizedMaterial: string } | null;
      if (entry) {
        const stock = await TrolleyStockModel.findOne({ ...getUserFilter(userId), normalizedMaterial: entry.normalizedMaterial }).lean() as { _id: Types.ObjectId; totalRairi: number; totalCost: number; avgRate: number } | null;
        if (stock) {
          const newRairi = rnd(stock.totalRairi + rairi);
          await TrolleyStockModel.updateOne({ _id: stock._id }, { $set: { totalRairi: newRairi, avgRate: newRairi > 0 ? Number((stock.totalCost / newRairi).toFixed(2)) : stock.avgRate, updatedAt: new Date() } });
        }
      }
    } else {
      const stock = await TrolleyStockModel.findOne({ ...getUserFilter(userId), normalizedMaterial: label }).lean() as { _id: Types.ObjectId; totalRairi: number; totalCost: number; avgRate: number } | null;
      if (stock) {
        const newRairi = rnd(stock.totalRairi + rairi);
        await TrolleyStockModel.updateOne({ _id: stock._id }, { $set: { totalRairi: newRairi, avgRate: newRairi > 0 ? Number((stock.totalCost / newRairi).toFixed(2)) : stock.avgRate, updatedAt: new Date() } });
      }
      const lastUsed = await TrolleyEntryModel.findOne({ ...getUserFilter(userId), normalizedMaterial: label, totalUsed: { $gte: rairi } }).sort({ updatedAt: -1 }).lean() as { _id: Types.ObjectId } | null;
      if (lastUsed) await TrolleyEntryModel.updateOne({ _id: lastUsed._id }, { $inc: { totalUsed: -rairi } });
    }
  }
}

async function applyTrolleyUsage(userId: string, mixes: MixBody[]): Promise<void> {
  for (const mix of mixes) {
    const rairi = rnd(mix.rairi || 0);
    if (rairi <= 0) continue;
    const normalized = mix.label.toLowerCase().trim();
    if (mix.trolleyEntryId) {
      const entry = await TrolleyEntryModel.findOneAndUpdate({ ...getUserFilter(userId), localId: mix.trolleyEntryId }, { $inc: { totalUsed: rairi } }, { new: true }).lean() as { normalizedMaterial: string } | null;
      if (entry) {
        const stock = await TrolleyStockModel.findOne({ ...getUserFilter(userId), normalizedMaterial: entry.normalizedMaterial }).lean() as { _id: Types.ObjectId; totalRairi: number; totalCost: number; avgRate: number } | null;
        if (stock) {
          const newRairi = Math.max(0, rnd(stock.totalRairi - rairi));
          await TrolleyStockModel.updateOne({ _id: stock._id }, { $set: { totalRairi: newRairi, avgRate: newRairi > 0 ? Number((stock.totalCost / newRairi).toFixed(2)) : stock.avgRate, updatedAt: new Date() } });
        }
      }
    } else {
      const stock = await TrolleyStockModel.findOne({ ...getUserFilter(userId), normalizedMaterial: normalized }).lean() as { _id: Types.ObjectId; totalRairi: number; totalCost: number; avgRate: number } | null;
      if (stock) {
        const newRairi = Math.max(0, rnd(stock.totalRairi - rairi));
        await TrolleyStockModel.updateOne({ _id: stock._id }, { $set: { totalRairi: newRairi, avgRate: newRairi > 0 ? Number((stock.totalCost / newRairi).toFixed(2)) : stock.avgRate, updatedAt: new Date() } });
      }
      const oldestOpen = await TrolleyEntryModel.findOne({ ...getUserFilter(userId), normalizedMaterial: normalized, status: "OPEN" }).sort({ date: 1 }).lean() as { _id: Types.ObjectId } | null;
      if (oldestOpen) await TrolleyEntryModel.updateOne({ _id: oldestOpen._id }, { $inc: { totalUsed: rairi } });
    }
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const daily = await BlockDaily.findOne({ _id: id, userId: session.user.id }).lean();
    if (!daily) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(daily);
  } catch { return NextResponse.json({ error: "Failed" }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const daily = await BlockDaily.findOne({ _id: id, userId: userId });
    if (!daily) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = await BlockProduct.findOne({ userId: userId, name: { $regex: `^${daily.blocksMade.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: 'i' } });
    if (existing) {
      const newStock = Math.max(0, rnd(existing.stock) - rnd(daily.blocksCount));
      await BlockProduct.updateOne({ _id: existing._id }, { $set: { stock: newStock } });
    }
    await revertTrolleyUsage(userId, (daily.mixMaterials as MixForRevert[]) || []);
    await BlockDaily.deleteOne({ _id: id });
    const d = daily.date ? new Date(daily.date) : new Date();
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    await recalcMonthlyExpense(userId, monthStr);
    return NextResponse.json({ ok: true });
  } catch (e) { console.error(e); return NextResponse.json({ error: "Delete failed" }, { status: 500 }); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const body = await req.json() as { blocksMade?: string; blocksCount?: number; cementBags?: number; ratePerBlock?: number; blockType?: string; date?: string; bills?: BillBody[]; mixMaterials?: MixBody[]; isMonthlyElectricity?: boolean; };
    const old = await BlockDaily.findOne({ _id: id, userId: userId });
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const newCount = rnd(body.blocksCount ?? old.blocksCount);
    const newName = body.blocksMade?.trim() || old.blocksMade;
    const diff = newCount - rnd(old.blocksCount);
    const isNameChanged = newName.toLowerCase() !== old.blocksMade.toLowerCase();
    const newRate = rnd(body.ratePerBlock ?? old.ratePerBlock);
    const cleanBills: BillBody[] = (body.bills ?? (old.bills as BillBody[]) ?? []).filter((b) => b.label?.trim()).map((b) => ({ label: b.label.trim(), amount: rnd(b.amount || 0) }));
    const cleanMix: MixBody[] = (body.mixMaterials ?? (old.mixMaterials as MixBody[]) ?? []).filter((m) => m.label?.trim() && (m.rairi || 0) > 0).map((m) => ({ label: m.label.trim(), qty: m.qty?.trim() || `${rnd(m.rairi || 0)} Rairi`, rairi: rnd(m.rairi || 0), rate: rnd(m.rate || 0), amount: rnd(m.amount || rnd(m.rairi || 0) * rnd(m.rate || 0)), trolleyEntryId: m.trolleyEntryId?.trim() }));
    const extraBills = cleanBills.reduce((sum, b) => { if (b.label.toLowerCase().includes("labour")) return sum; if ((body.isMonthlyElectricity ?? old.isMonthlyElectricity) && (b.label.toLowerCase().includes("electric") || b.label.includes("بجلی"))) return sum; return sum + (b.amount || 0); }, 0);
    const mixCost = cleanMix.reduce((s, m) => s + (m.amount || 0), 0);
    const newWages = rnd(newCount * newRate);
    const totalBill = newWages + extraBills + mixCost;
    await revertTrolleyUsage(userId, (old.mixMaterials as MixForRevert[]) || []);
    const updated = await BlockDaily.findOneAndUpdate({ _id: id }, { blocksMade: newName, blocksCount: newCount, cementBags: body.cementBags !== undefined ? rnd(body.cementBags) : old.cementBags, ratePerBlock: newRate, dailyWages: newWages, blockType: body.blockType || old.blockType, date: body.date ? new Date(body.date) : old.date, bills: cleanBills, mixMaterials: cleanMix, mixCost, totalBill, costPerBlock: newCount > 0 ? Math.round((totalBill / newCount) * 100) / 100 : 0, isMonthlyElectricity: body.isMonthlyElectricity ?? old.isMonthlyElectricity ?? false }, { new: true });
    await applyTrolleyUsage(userId, cleanMix);
    if (isNameChanged) {
      const oldProd = await BlockProduct.findOne({ userId: userId, name: { $regex: `^${old.blocksMade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: 'i' } });
      const newProd = await BlockProduct.findOne({ userId: userId, name: { $regex: `^${newName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: 'i' } });
      if (oldProd) await BlockProduct.updateOne({ _id: oldProd._id }, { $inc: { stock: -rnd(old.blocksCount) } });
      if (newProd) await BlockProduct.updateOne({ _id: newProd._id }, { $inc: { stock: newCount } });
    } else if (diff !== 0) {
      const prod = await BlockProduct.findOne({ userId: userId, name: { $regex: `^${old.blocksMade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: 'i' } });
      if (prod) await BlockProduct.updateOne({ _id: prod._id }, { $inc: { stock: diff } });
    }
    const d = updated?.date ? new Date(updated.date) : new Date(old.date);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    await recalcMonthlyExpense(userId, monthStr);
    return NextResponse.json(updated);
  } catch (e) { console.error(e); return NextResponse.json({ error: "Update failed" }, { status: 500 }); }
}