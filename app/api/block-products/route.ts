import connectDB from "@/lib/mongodb";
import BlockProduct from "@/models/BlockProduct";
import type { StockHistoryItem } from "@/models/BlockProduct";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "other";
type StockMode = "limited" | "unlimited";

type BlockProductBody = {
  localId?: string;
  userId?: string;
  name?: string;
  category?: BlockCategory;
  stock?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  sellPrice?: number;
  lastPurchaseDate?: string;
  stockMode?: StockMode;
  isAddingStock?: boolean;
};

type ProductQuery = {
  userId: string;
  category?: string;
  name?: { $regex: string; $options: string };
};

function rnd(n: number): number { return Math.round(n || 0); }

export async function GET(req: NextRequest) {
  await connectDB();
  const session = await getServerSession(authOptions);
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || session?.user?.id;
  if (!userId) return NextResponse.json({ products: [], data: [] });
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const query = { userId } as ProductQuery;
  if (category && category !== "all") query.category = category;
  if (search) query.name = { $regex: search, $options: "i" };
  const products = await BlockProduct.find(query).sort({ category: 1, createdAt: -1 }).limit(500).lean();
  return NextResponse.json({ products, data: products });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as BlockProductBody;
  const session = await getServerSession(authOptions);
  const userId = body.userId || session?.user?.id;
  if (!userId || !body.name) return NextResponse.json({ error: "Missing name/userId" }, { status: 400 });

  const name = body.name.trim();
  const normalizedName = name.toLowerCase();
  const category = (body.category || "crush") as BlockCategory;
  const stockMode = (body.stockMode || "limited") as StockMode;
  const addQty = rnd(body.stock || 0);
  const buyPrice = rnd(body.buyPrice || body.buyPriceAvg || 0);
  const buyAvg = rnd(body.buyPriceAvg || body.buyPrice || 0);
  const sellPrice = rnd(body.sellPrice || 0);
  const now = body.lastPurchaseDate ? new Date(body.lastPurchaseDate) : new Date();
  const historyEntry: StockHistoryItem = { qty: addQty, date: now, buyPrice: buyAvg, sellPrice };

  // Same product exists → ADD stock + push publish date (shows all dates)
  const existing = await BlockProduct.findOne({ userId, normalizedName, category });
  if (existing) {
    existing.stock = rnd(existing.stock + addQty);
    existing.lastPurchaseDate = now;
    if (buyPrice) existing.buyPrice = buyPrice;
    if (buyAvg) existing.buyPriceAvg = buyAvg;
    if (sellPrice) existing.sellPrice = sellPrice;
    existing.stockHistory.push(historyEntry);
    if (body.localId) existing.localId = body.localId;
    await existing.save();
    return NextResponse.json({ product: existing, products: existing });
  }

  // New product Day1
  try {
    const created = await BlockProduct.create({
      name, normalizedName, category, stock: addQty, stockMode,
      buyPrice, buyPriceAvg: buyAvg, sellPrice, lastPurchaseDate: now,
      userId, localId: body.localId || `srv_${Date.now()}`,
      stockHistory: [historyEntry],
    });
    return NextResponse.json(created);
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 11000) {
      const dup = await BlockProduct.findOne({ userId, normalizedName, category });
      if (dup) {
        dup.stock = rnd(dup.stock + addQty);
        dup.stockHistory.push(historyEntry);
        await dup.save();
        return NextResponse.json(dup);
      }
    }
    throw err;
  }
}