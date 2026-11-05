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
type EntryFilter = UserFilter & { status?: TrolleyStatus };

function getUserFilter(userId: string): UserFilter {
  if (Types.ObjectId.isValid(userId)) {
    return { $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] };
  }
  return { userId: userId };
}

function getRairiForMaterial(name: string): number {
  const nm = name.toLowerCase().trim();
  if (nm.includes("گھٹہ") || nm.includes("ghata") || nm.includes("گھٹہ شگہ")) return 55;
  if (nm.includes("بجری") || nm.includes("bajri") || nm.includes("crush")) return 55;
  return 60;
}

export async function GET(req: NextRequest) {
  await connectDB();
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = req.nextUrl.searchParams.get("userId") || session?.user?.id;
  if (!userId) return NextResponse.json({ data: [], stock: [] });

  const statusParam = req.nextUrl.searchParams.get("status");
  const base = getUserFilter(userId);
  const entryFilter: EntryFilter = { ...base } as EntryFilter;
  if (isValidStatus(statusParam)) {
    entryFilter.status = statusParam;
  }

  const entries = await TrolleyEntryModel.find(entryFilter).sort({ date: -1 }).limit(200).lean();
  const stock = await TrolleyStockModel.find({ ...getUserFilter(userId) }).sort({ updatedAt: -1 }).lean();

  return NextResponse.json({ data: entries, stock, entries });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as {
    material: string;
    rairiInTrolley: number;
    actualRairi?: number;
    trolleyPrice: number;
    date?: string;
    localId?: string;
    userId?: string;
    purpose?: "factory" | "direct_sale";
  };
  const session = (await getServerSession(authOptions)) as { user?: { id?: string } } | null;
  const userId = body.userId || session?.user?.id;
  if (!userId) return NextResponse.json({ error: "userId missing" }, { status: 400 });

  if (!body.material?.trim()) return NextResponse.json({ error: "material required" }, { status: 400 });

  const rairiInput = rnd(body.rairiInTrolley) || getRairiForMaterial(body.material);
  const actualRairi = body.actualRairi !== undefined ? rnd(body.actualRairi) : rairiInput;
  const price = rnd(body.trolleyPrice);
  if (rairiInput <= 0 || price <= 0) return NextResponse.json({ error: "rairi and price > 0" }, { status: 400 });

  const purpose = body.purpose || "factory";
  const material = body.material.trim();
  const normalized = material.toLowerCase().trim();
  const rate = Number((price / rairiInput).toFixed(2));
  const localId = body.localId || `trolley_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const rairiLoss = Math.max(0, rairiInput - actualRairi);

  const entry = await TrolleyEntryModel.create({
    date: body.date ? new Date(body.date) : new Date(),
    material,
    normalizedMaterial: normalized,
    rairiInTrolley: rairiInput,
    actualRairi,
    rairiRemaining: actualRairi,
    rairiLoss,
    trolleyPrice: price,
    perRairiRate: rate,
    status: "OPEN",
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
    const newTotalRairi = rnd(existingStock.totalRairi + actualRairi);
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
      totalRairi: actualRairi,
      totalCost: price,
      avgRate: rate,
      userId,
      localId: `stock_${normalized}`,
    });
  }

  return NextResponse.json({ data: entry, entry });
}