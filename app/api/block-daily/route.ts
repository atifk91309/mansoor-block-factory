import connectDB from "@/lib/mongodb";
import BlockDaily from "@/models/BlockDaily";
import BlockProduct from "@/models/BlockProduct";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BlockDailyBody = {
  localId?: string;
  userId?: string;
  date?: string;
  cementBags?: number;
  blocksMade?: string; // ✅ STRING - Slim Block etc
  blocksCount?: number; // ✅ NEW qty 1500
  dailyWages?: number;
  ratePerBlock?: number;
  blockType?: string;
};

type DailyQuery = {
  userId: string;
  date?: { $gte: Date; $lte: Date };
};

function rnd(n: number): number { return Math.round(n || 0); }

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

  const daily = await BlockDaily.create({
    date: body.date ? new Date(body.date) : new Date(),
    cementBags: rnd(body.cementBags || 0),
    blocksMade: name, // ✅ string
    blocksCount: count, // ✅ qty
    dailyWages: wages,
    ratePerBlock: rate,
    blockType: body.blockType || "6 inch",
    userId,
  });

  // ✅ Find by exact name Slim Block etc - no duplicate crush
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
    // fallback old logic - inc any block category
    await BlockProduct.findOneAndUpdate(
      { userId, category: "block", name: { $regex: body.blockType || "6", $options: "i" } },
      { $inc: { stock: count } }
    );
  }

  return NextResponse.json(daily);
}