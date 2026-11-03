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
  label: string;
  qty?: string;
  rairi: number;
  rate: number;
  amount?: number;
  trolleyEntryId?: string;
};
type BlockDailyBody = {
  localId?: string;
  userId?: string;
  date?: string;
  cementBags?: number;
  blocksMade?: string;
  blocksCount?: number;
  dailyWages?: number;
  ratePerBlock?: number;
  blockType?: string;
  bills?: BillBody[];
  mixMaterials?: MixBody[];
  isMonthlyElectricity?: boolean;
};

function rnd(n: number): number {
  return Math.round(n || 0);
}

function getUserFilter(userId: string): Record<string, unknown> {
  if (Types.ObjectId.isValid(userId)) {
    return {
      $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }],
    };
  }
  return { userId: userId };
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
  const dateFilter: Record<string, unknown> = from && to
    ? { date: { $gte: new Date(from), $lte: new Date(to) } }
    : {};

  const data = await BlockDaily.find({
    ...baseFilter,
    ...dateFilter,
  }).sort({ date: -1 }).limit(500).lean();

  return NextResponse.json({ data, blockDailies: data });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as BlockDailyBody;
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId" }, { status: 400 });

  if (!body.blocksMade?.trim()) {
    return NextResponse.json({ error: "blocksMade name required" }, { status: 400 });
  }

  const rate = rnd(body.ratePerBlock || 3);
  const count = rnd(body.blocksCount || 0);
  if (count <= 0) return NextResponse.json({ error: "blocksCount > 0 required" }, { status: 400 });
  
  const wages = rnd(body.dailyWages || count * rate);
  const name = body.blocksMade.trim();

  const cleanBills = (body.bills || [])
    .filter((b) => b.label?.trim())
    .map((b) => ({ label: b.label.trim(), amount: rnd(b.amount || 0) }));

  const cleanMix = (body.mixMaterials || [])
    .filter((m) => m.label?.trim() && (m.rairi || 0) > 0)
    .map((m) => {
      const rairi = rnd(m.rairi || 0);
      const ratePerRairi = rnd(m.rate || 0);
      return {
        label: m.label.trim(),
        qty: m.qty?.trim() || `${rairi} Rairi`,
        rairi,
        rate: ratePerRairi,
        amount: rnd(m.amount || rairi * ratePerRairi),
        trolleyEntryId: m.trolleyEntryId?.trim(),
      };
    });

  const extraBills = cleanBills.reduce((sum, b) => {
    if (b.label.toLowerCase().includes("labour")) return sum;
    if (body.isMonthlyElectricity && (b.label.toLowerCase().includes("electric") || b.label.includes("بجلی"))) return sum;
    return sum + (b.amount || 0);
  }, 0);
  const mixCost = cleanMix.reduce((s, m) => s + (m.amount || 0), 0);
  const totalBill = wages + extraBills + mixCost;

  const dailyDate = body.date ? new Date(body.date) : new Date();

  const daily = await BlockDaily.create({
    date: dailyDate,
    cementBags: rnd(body.cementBags || 0),
    blocksMade: name,
    blocksCount: count,
    dailyWages: wages,
    ratePerBlock: rate,
    blockType: body.blockType || "6 inch",
    userId,
    bills: cleanBills,
    mixMaterials: cleanMix,
    totalBill,
    mixCost,
    costPerBlock: count > 0 ? Math.round((totalBill / count) * 100) / 100 : 0,
    isMonthlyElectricity: body.isMonthlyElectricity || false,
    localId: body.localId,
  });

  // --- AUTO-DEDUCT TROLLEY STOCK - FINAL FIX FOR Used=0 ---
  for (const mix of cleanMix) {
    if (mix.rairi <= 0) continue;
    const normalized = mix.label.toLowerCase().trim();

    // 1. Try to find entry directly by userId (string) + localId
    let entryDoc = null as { _id: unknown; normalizedMaterial: string } | null;
    
    if (mix.trolleyEntryId) {
      entryDoc = await TrolleyEntryModel.findOne({
        userId: userId,
        localId: mix.trolleyEntryId,
      }).lean() as typeof entryDoc;
    }

    // 2. Fallback: oldest OPEN entry of same material (FIFO)
    if (!entryDoc) {
      entryDoc = await TrolleyEntryModel.findOne({
        userId: userId,
        normalizedMaterial: normalized,
        status: "OPEN",
      }).sort({ date: 1 }).lean() as typeof entryDoc;
    }

    if (entryDoc) {
      await TrolleyEntryModel.updateOne(
        { _id: entryDoc._id as string },
        { $inc: { totalUsed: mix.rairi } }
      );
    }

    // 3. Deduct aggregated stock
    const stock = await TrolleyStockModel.findOne({
      userId: userId,
      normalizedMaterial: entryDoc?.normalizedMaterial || normalized,
    });

    if (stock) {
      const newRairi = Math.max(0, rnd(stock.totalRairi - mix.rairi));
      const costDeduct = rnd(mix.rairi * stock.avgRate);
      await TrolleyStockModel.updateOne(
        { _id: stock._id },
        {
          $set: {
            totalRairi: newRairi,
            totalCost: Math.max(0, rnd(stock.totalCost - costDeduct)),
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  const monthStr = `${dailyDate.getFullYear()}-${String(dailyDate.getMonth() + 1).padStart(2, "0")}`;
  await recalcMonthlyExpense(userId, monthStr);

  const existing = await BlockProduct.findOne({ 
    userId, 
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: 'i' } 
  });

  if (existing) {
    await BlockProduct.updateOne(
      { _id: existing._id },
      { 
        $inc: { stock: count },
        $push: { stockHistory: { qty: count, date: daily.date, buyPrice: 0, sellPrice: existing.sellPrice } },
        $set: { lastPurchaseDate: daily.date }
      }
    );
  } else {
    await BlockProduct.findOneAndUpdate(
      { userId, category: "block", name: { $regex: body.blockType || "6", $options: 'i' } },
      { $inc: { stock: count } }
    );
  }

  return NextResponse.json(daily);
}