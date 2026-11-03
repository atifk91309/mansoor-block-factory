import connectDB from "@/lib/mongodb";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TrolleyBody = {
  material: string;
  rairiInTrolley: number;
  trolleyPrice: number;
  date?: string;
  localId?: string;
  userId?: string;
};

function rnd(n: number): number { return Math.round(Number(n) || 0); }

function getUserFilter(userId: string): Record<string, unknown> {
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

  const status = req.nextUrl.searchParams.get("status");
  const filter: Record<string, unknown> = { ...getUserFilter(userId) };
  if (status) filter.status = status;

  const entries = await TrolleyEntryModel.find(filter).sort({ date: -1 }).limit(200).lean();
  const stock = await TrolleyStockModel.find(getUserFilter(userId)).sort({ updatedAt: -1 }).lean();

  return NextResponse.json({ data: entries, stock, entries });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as TrolleyBody;
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId missing" }, { status: 400 });

  if (!body.material?.trim()) return NextResponse.json({ error: "material required" }, { status: 400 });
  const rairi = rnd(body.rairiInTrolley);
  const price = rnd(body.trolleyPrice);
  if (rairi <= 0 || price <= 0) return NextResponse.json({ error: "rairi and price > 0" }, { status: 400 });

  const material = body.material.trim();
  const normalized = material.toLowerCase().trim();
  const rate = Number((price / rairi).toFixed(2));
  const localId = body.localId || `trolley_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

  const entry = await TrolleyEntryModel.create({
    date: body.date ? new Date(body.date) : new Date(),
    material,
    normalizedMaterial: normalized,
    rairiInTrolley: rairi,
    trolleyPrice: price,
    perRairiRate: rate,
    status: "OPEN" as const,
    totalUsed: 0,
    userId,
    localId,
  });

  const existingStock = await TrolleyStockModel.findOne({ 
    ...getUserFilter(userId), 
    normalizedMaterial: normalized 
  });

  if (existingStock) {
    const newTotalRairi = rnd(existingStock.totalRairi + rairi);
    const newTotalCost = rnd(existingStock.totalCost + price);
    const newAvg = newTotalRairi > 0 ? Number((newTotalCost / newTotalRairi).toFixed(2)) : rate;

    await TrolleyStockModel.updateOne(
      { _id: existingStock._id },
      { $set: { totalRairi: newTotalRairi, totalCost: newTotalCost, avgRate: newAvg, material, updatedAt: new Date() } }
    );
  } else {
    await TrolleyStockModel.create({
      material,
      normalizedMaterial: normalized,
      totalRairi: rairi,
      totalCost: price,
      avgRate: rate,
      userId,
      localId: `stock_${normalized}`,
    });
  }

  return NextResponse.json({ data: entry, entry });
}