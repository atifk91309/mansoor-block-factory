import connectDB from "@/lib/mongodb";
import BlockProduct from "@/models/BlockProduct";
import type { StockHistoryItem } from "@/models/BlockProduct";
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type UpdateBody = {
  name?: string;
  category?: "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "other";
  stock?: number;
  stockMode?: "limited" | "unlimited";
  buyPrice?: number;
  buyPriceAvg?: number;
  sellPrice?: number;
  lastPurchaseDate?: string;
  isAddingStock?: boolean;
};

function rnd(n: number): number { return Math.round(n || 0); }
function isValidId(id: string): boolean { return mongoose.Types.ObjectId.isValid(id); }

export async function GET(_req: NextRequest, { params }: Params) {
  await connectDB();
  const { id } = await params; // ✅ Next.js 15 must await
  if (!isValidId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const product = await BlockProduct.findById(id).lean();
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ product, data: product });
}

export async function PUT(req: NextRequest, { params }: Params) {
  await connectDB();
  const { id } = await params; // ✅ Next.js 15 must await
  if (!isValidId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await req.json()) as UpdateBody;
  const existing = await BlockProduct.findById(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = body.lastPurchaseDate ? new Date(body.lastPurchaseDate) : new Date();

  if (body.name) {
    existing.name = body.name.trim();
    existing.normalizedName = body.name.trim().toLowerCase();
  }
  if (body.category) existing.category = body.category;
  if (body.stockMode) existing.stockMode = body.stockMode;
  if (typeof body.buyPrice === "number") existing.buyPrice = rnd(body.buyPrice);
  if (typeof body.buyPriceAvg === "number") existing.buyPriceAvg = rnd(body.buyPriceAvg);
  if (typeof body.sellPrice === "number") existing.sellPrice = rnd(body.sellPrice);

  if (typeof body.stock === "number") {
    const newQty = rnd(body.stock);
    if (body.isAddingStock) {
      existing.stock = rnd(existing.stock + newQty);
      const entry: StockHistoryItem = {
        qty: newQty,
        date: now,
        buyPrice: existing.buyPriceAvg,
        sellPrice: existing.sellPrice,
      };
      existing.stockHistory.push(entry);
      existing.lastPurchaseDate = now;
    } else {
      existing.stock = newQty;
    }
  }

  await existing.save();
  return NextResponse.json({ product: existing });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await connectDB();
    const { id } = await params; // ✅ Next.js 15 must await
    if (!id || !isValidId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }
    const deleted = await BlockProduct.findByIdAndDelete(id);
    if (!deleted) return NextResponse.json({ ok: true, message: "Already deleted" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE error:", err);
    return NextResponse.json({ ok: false, error: "Delete failed" }, { status: 500 });
  }
}