import connectDB from "@/lib/mongodb";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TrolleyStatus = "OPEN" | "CLOSED" | "SOLD";
const VALID_STATUSES: TrolleyStatus[] = ["OPEN", "CLOSED", "SOLD"];

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

function isValidStatus(s: string | null): s is TrolleyStatus {
  return s !== null && (VALID_STATUSES as string[]).includes(s);
}

type UserFilter = { userId: string } | { $or: [{ userId: Types.ObjectId }, { userId: string }] };
function getUserFilter(userId: string): UserFilter {
  if (Types.ObjectId.isValid(userId)) {
    return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  }
  return { userId: userId };
}

export async function GET(req: NextRequest) {
  await connectDB();
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = req.nextUrl.searchParams.get("userId") || session?.user?.id;
  if (!userId) return NextResponse.json({ data: [], stock: [] });

  const statusParam = req.nextUrl.searchParams.get("status");
  const base = getUserFilter(userId);
  const entryFilter: Record<string, unknown> = { ...base };
  if (isValidStatus(statusParam)) {
    entryFilter.status = statusParam;
  }

  const allStocks = await TrolleyStockModel.find({ ...base }).lean();
  const zeroNorms = allStocks.filter(s => (s.totalRairi || 0) <= 0).map(s => s.normalizedMaterial);
  if (zeroNorms.length > 0) {
    await TrolleyStockModel.deleteMany({ ...base, normalizedMaterial: { $in: zeroNorms } });
  }

  const entries = await TrolleyEntryModel.find(entryFilter).sort({ date: -1 }).limit(200).lean();
  const stock = await TrolleyStockModel.find({ ...base }).sort({ updatedAt: -1 }).lean();
  const filteredStock = stock.filter(s => (s.totalRairi || 0) > 0);

  return NextResponse.json({ data: entries, stock: filteredStock, entries });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as {
    material: string;
    rairiInTrolley?: number;
    rairiPerTrolley?: number;
    quantity?: number;
    totalRairi?: number;
    actualRairi?: number;
    trolleyPrice: number;
    perRairiRate?: number;
    date?: string;
    localId?: string;
    userId?: string;
    purpose?: "factory" | "direct_sale";
    unit?: string;
  };
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId missing" }, { status: 400 });

  if (!body.material?.trim()) return NextResponse.json({ error: "material required" }, { status: 400 });

  const FROZEN_RAIRI = 60;
  const qty = body.quantity ?? 0;
  const totalR = body.totalRairi ?? 0;
  // Creation pe hamesha 60 hi OPEN me
  const initialRairi = rnd(totalR || (qty ? qty * FROZEN_RAIRI : 0) || FROZEN_RAIRI);

  const price = rnd(body.trolleyPrice);
  if (price <= 0 || initialRairi <= 0) return NextResponse.json({ error: "rairi and price > 0" }, { status: 400 });

  const purpose = body.purpose || "factory";
  const material = body.material.trim();
  const normalized = material.toLowerCase().trim();
  
  // ✅ Creation pe frozen rate dikhao, asal rate close pe banega
  const initialRate = Number((price / FROZEN_RAIRI).toFixed(2));

  const localId = body.localId || `trolley_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const entry = await TrolleyEntryModel.create({
    date: body.date ? new Date(body.date) : new Date(),
    material,
    normalizedMaterial: normalized,
    rairiInTrolley: initialRairi, // 60
    // actualRairi abhi null rakho, close pe aayega
    rairiRemaining: initialRairi,
    rairiLoss: 0,
    trolleyPrice: price,
    perRairiRate: initialRate, // frozen
    status: "OPEN" as TrolleyStatus,
    purpose,
    totalUsed: 0,
    userId,
    localId,
  });

  const existingStock = await TrolleyStockModel.findOne({
    ...getUserFilter(userId),
    normalizedMaterial: normalized,
  });

  if (existingStock) {
    if ((existingStock.totalRairi || 0) <= 0) {
      await TrolleyStockModel.deleteOne({ _id: existingStock._id });
      await TrolleyStockModel.create({
        material,
        normalizedMaterial: normalized,
        totalRairi: initialRairi,
        totalCost: price,
        avgRate: initialRate,
        userId: existingStock.userId, // same type rakho
        localId: `stock_${normalized}_${Date.now()}`,
      });
    } else {
      const newTotalRairi = rnd(existingStock.totalRairi + initialRairi);
      const newTotalCost = rnd(existingStock.totalCost + price);
      const weightedAvg = Number(((existingStock.avgRate * existingStock.totalRairi + initialRate * initialRairi) / newTotalRairi).toFixed(2));
      await TrolleyStockModel.updateOne(
        { _id: existingStock._id },
        { $set: { totalRairi: newTotalRairi, totalCost: newTotalCost, avgRate: weightedAvg, material, updatedAt: new Date() } }
      );
    }
  } else {
    await TrolleyStockModel.create({
      material,
      normalizedMaterial: normalized,
      totalRairi: initialRairi,
      totalCost: price,
      avgRate: initialRate,
      userId,
      localId: `stock_${normalized}_${Date.now()}`,
    });
  }

  return NextResponse.json({ data: entry, entry });
}