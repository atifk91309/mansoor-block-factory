import connectDB from "@/lib/mongodb";
import BlockDaily from "@/models/BlockDaily";
import BlockProduct from "@/models/BlockProduct";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BillBody = {
  label: string;
  amount: number;
};

type MixBody = {
  label: string;
  qty: string; // "7 Hath", "19 Hath Rairi" - STRING
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
  bills?: BillBody[]; // NEW DYNAMIC
  mixMaterials?: MixBody[]; // NEW DYNAMIC
  isMonthlyElectricity?: boolean;
};

type DailyQuery = {
  userId: string;
  date?: { $gte: Date; $lte: Date };
};

function rnd(n: number): number { 
  return Math.round(n || 0); 
}

export async function GET(req: NextRequest) {
  await connectDB();
  const session = await getServerSession(authOptions);
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId" }, { status: 400 });

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const query: DailyQuery = { userId };
  if (from && to) query.date = { $gte: new Date(from), $lte: new Date(to) };

  const data = await BlockDaily.find(query).sort({ date: -1 }).limit(500).lean();
  return NextResponse.json({ data, blockDailies: data });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as BlockDailyBody;
  const session = await getServerSession(authOptions);
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId" }, { status: 400 });

  if (!body.blocksMade || !body.blocksMade.trim()) {
    return NextResponse.json({ error: "blocksMade name required" }, { status: 400 });
  }

  const rate = rnd(body.ratePerBlock || 3);
  const count = rnd(body.blocksCount || 0);
  if (count <= 0) return NextResponse.json({ error: "blocksCount > 0 required" }, { status: 400 });
  
  const wages = rnd(body.dailyWages || count * rate);
  const name = body.blocksMade.trim();

  // Clean bills - filter empty labels
  const cleanBills: BillBody[] = (body.bills || [])
    .filter(b => b.label && b.label.trim().length > 0)
    .map(b => ({
      label: b.label.trim(),
      amount: rnd(b.amount || 0)
    }));

  // Clean mix materials - filter empty labels, qty is STRING
  const cleanMix: MixBody[] = (body.mixMaterials || [])
    .filter(m => m.label && m.label.trim().length > 0)
    .map(m => ({
      label: m.label.trim(),
      qty: m.qty ? m.qty.trim() : ""
    }));

  // Calculate totalBill
  const extraBills = cleanBills.reduce((sum, b) => {
    if (b.label.toLowerCase().includes("labour")) return sum;
    return sum + (b.amount || 0);
  }, 0);
  const totalBill = wages + extraBills;

  const daily = await BlockDaily.create({
    date: body.date ? new Date(body.date) : new Date(),
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
    costPerBlock: count > 0 ? Math.round((totalBill / count) * 10) / 10 : 0,
    isMonthlyElectricity: body.isMonthlyElectricity || false,
  });

  // Stock update - same as before
  const existing = await BlockProduct.findOne({ 
    userId, 
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } 
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
      { userId, category: "block", name: { $regex: body.blockType || "6", $options: "i" } },
      { $inc: { stock: count } }
    );
  }

  return NextResponse.json(daily);
}