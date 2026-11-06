import connectDB from "@/lib/mongodb";
import MonthlyExpense from "@/models/MonthlyExpense";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MonthlyBody = {
  month: string;
  batchId?: string;
  electricity?: number;
  rent?: number;
  other?: number;
  totalMonthly?: number;
  totalBlocks?: number;
  totalDailyBill?: number;
  totalMixCost?: number;
  totalCementCost?: number;
  totalCementBags?: number;
  totalTrolleyCost?: number;
  totalRairiUsed?: number;
  totalLabourCost?: number;
  costPerBlock?: number;
  grandCostPerBlock?: number;
  trueCostPerBlock?: number;
  userId?: string;
  _id?: string;
};
type SessionUser = { user?: { id?: string } };

function rnd(n: number): number { return Math.round(Number(n) || 0); }

function toObjectIdIfValid(id: string): Types.ObjectId | string {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : id;
}

function getUserFilter(userId: string, month?: string) {
  const filter: { userId: { $in: (Types.ObjectId | string)[] } | string; month?: string } = {
    userId: Types.ObjectId.isValid(userId) 
      ? { $in: [new Types.ObjectId(userId), userId] } 
      : userId,
  };
  if (month) filter.month = month;
  return filter;
}

export async function GET(req: NextRequest) {
  await connectDB();
  const session = (await getServerSession(authOptions)) as SessionUser | null;
  const queryUserId = req.nextUrl.searchParams.get("userId");
  const userId = session?.user?.id || queryUserId;
  if (!userId) return NextResponse.json({ data: [] });

  const month = req.nextUrl.searchParams.get("month") || undefined;
  const filter = getUserFilter(userId, month);

  const data = await MonthlyExpense.find(filter).sort({ month: -1 }).lean();
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as MonthlyBody;

  if (!body.month) {
    return NextResponse.json({ error: "month required YYYY-MM" }, { status: 400 });
  }

  const session = (await getServerSession(authOptions)) as SessionUser | null;
  const userIdRaw = session?.user?.id || body.userId;
  if (!userIdRaw) return NextResponse.json({ error: "userId missing" }, { status: 400 });

  const userId = toObjectIdIfValid(userIdRaw);
  const batchId = body.batchId;
  const electricity = rnd(body.electricity || 0);
  const rent = rnd(body.rent || 0);
  const other = rnd(body.other || 0);
  const totalBlocks = rnd(body.totalBlocks || 0);
  const totalDailyBill = rnd(body.totalDailyBill || 0);
  const totalMixCost = rnd(body.totalMixCost || 0);
  const totalCementCost = rnd(body.totalCementCost || 0);
  const totalCementBags = rnd(body.totalCementBags || 0);
  const totalTrolleyCost = rnd(body.totalTrolleyCost || 0);
  const totalRairiUsed = rnd(body.totalRairiUsed || 0);
  const totalLabourCost = rnd(body.totalLabourCost || 0);
  
  const totalMonthly = electricity + rent + other;
  const costPerBlock = totalBlocks > 0 ? Number((totalMonthly / totalBlocks).toFixed(2)) : 0;
  const grandCostPerBlock = totalBlocks > 0 ? Number(((totalDailyBill + totalMonthly) / totalBlocks).toFixed(2)) : 0;

  // ✅ FIX: $in filter se upsert taake duplicate na bane
  const doc = await MonthlyExpense.findOneAndUpdate(
    { ...getUserFilter(userIdRaw), month: body.month },
    {
      month: body.month,
      batchId,
      userId, // ObjectId store
      electricity,
      rent,
      other,
      totalMonthly,
      totalBlocks,
      totalDailyBill,
      totalMixCost,
      totalCementCost,
      totalCementBags,
      totalTrolleyCost,
      totalRairiUsed,
      totalLabourCost,
      costPerBlock,
      grandCostPerBlock,
      trueCostPerBlock: grandCostPerBlock,
    },
    { upsert: true, new: true, runValidators: true }
  );

  return NextResponse.json({ data: doc });
}