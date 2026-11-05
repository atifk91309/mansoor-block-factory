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

function getRairiForMaterial(name: string): number {
  const nm = name.toLowerCase().trim();
  if (nm.includes("گھٹہ") || nm.includes("شگہ") || nm.includes("ghata") || nm.includes("shaga")) {
    return 55;
  }
  return 60;
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

  // 0 wale clean - direct filter for delete (no $or issue for delete)
  const allStocks = await TrolleyStockModel.find({ ...base }).lean() as unknown as { normalizedMaterial: string; totalRairi: number }[];
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

  const rairiInput = rnd(
    body.rairiInTrolley || 
    body.rairiPerTrolley || 
    body.totalRairi || 
    (body.quantity ? body.quantity * getRairiForMaterial(body.material) : 0) ||
    getRairiForMaterial(body.material)
  );
  const actualRairi = body.actualRairi !== undefined ? rnd(body.actualRairi) : rairiInput;
  const price = rnd(body.trolleyPrice);
  if (rairiInput <= 0 || price <= 0) return NextResponse.json({ error: "rairi and price > 0" }, { status: 400 });

  const purpose = body.purpose || "factory";
  const material = body.material.trim();
  const normalized = material.toLowerCase().trim();
  const rate = body.perRairiRate ? Number(Number(body.perRairiRate).toFixed(2)) : Number((price / rairiInput).toFixed(2));
  const localId = body.localId || `trolley_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const rairiLoss = Math.max(0, rairiInput - actualRairi);

  const entry = await TrolleyEntryModel.create({
    date: body.date ? new Date(body.date) : new Date(),
    material,
    normalizedMaterial: normalized,
    rairiInTrolley: rairiInput,
    actualRairi: actualRairi,
    rairiRemaining: actualRairi,
    rairiLoss,
    trolleyPrice: price,
    perRairiRate: rate,
    status: "OPEN" as TrolleyStatus,
    purpose,
    totalUsed: 0,
    userId,
    localId,
  });

  // ✅ FIX: Write me $or nahi - direct userId se upsert, warna Documents 0 rehta hai
  const existingStock = await TrolleyStockModel.findOne({
    userId: userId,
    normalizedMaterial: normalized,
  });

  if (existingStock) {
    if ((existingStock.totalRairi || 0) <= 0) {
      await TrolleyStockModel.deleteOne({ _id: existingStock._id });
      await TrolleyStockModel.create({
        material,
        normalizedMaterial: normalized,
        totalRairi: actualRairi,
        totalCost: price,
        avgRate: rate,
        userId,
        localId: `stock_${normalized}_${Date.now()}`,
      });
    } else {
      const newTotalRairi = rnd(existingStock.totalRairi + actualRairi);
      const newTotalCost = rnd(existingStock.totalCost + price);
      const newAvg = newTotalRairi > 0 ? Number((newTotalCost / newTotalRairi).toFixed(2)) : rate;
      await TrolleyStockModel.updateOne(
        { _id: existingStock._id },
        { $set: { totalRairi: newTotalRairi, totalCost: newTotalCost, avgRate: newAvg, material, updatedAt: new Date() } }
      );
    }
  } else {
    await TrolleyStockModel.create({
      material,
      normalizedMaterial: normalized,
      totalRairi: actualRairi,
      totalCost: price,
      avgRate: rate,
      userId,
      localId: `stock_${normalized}_${Date.now()}`,
    });
  }

  return NextResponse.json({ data: entry, entry });
}