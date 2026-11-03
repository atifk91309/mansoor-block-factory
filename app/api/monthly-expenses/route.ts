import connectDB from "@/lib/mongodb";
import MonthlyExpense from "@/models/MonthlyExpense";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MonthlyBody = {
  month: string;
  electricity?: number;
  rent?: number;
  other?: number;
  totalMonthly?: number;
  totalBlocks?: number;
  totalDailyBill?: number;
  costPerBlock?: number;
  grandCostPerBlock?: number;
  userId?: string;
  _id?: string;
};

function rnd(n: number): number {
  return Math.round(n || 0);
}

export async function GET(req: NextRequest) {
  await connectDB();
  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  const queryUserId = req.nextUrl.searchParams.get("userId");
  const userId = session?.user?.id || queryUserId;
  if (!userId) return NextResponse.json({ data: [] });

  const month = req.nextUrl.searchParams.get("month");
  const filter: Record<string, unknown> = { userId };
  if (month) filter.month = month;

  const data = await MonthlyExpense.find(filter).sort({ month: -1 }).lean();
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  await connectDB();
  const body = (await req.json()) as MonthlyBody;

  if (!body.month) {
    return NextResponse.json({ error: "month required YYYY-MM" }, { status: 400 });
  }

  const session = await getServerSession(authOptions) as { user?: { id?: string } } | null;
  const userId = session?.user?.id || body.userId;
  if (!userId) return NextResponse.json({ error: "userId missing" }, { status: 400 });

  // Explicit calc - double safety with your new model hook
  const electricity = rnd(body.electricity || 0);
  const rent = rnd(body.rent || 0);
  const other = rnd(body.other || 0);
  const totalBlocks = rnd(body.totalBlocks || 0);
  const totalDailyBill = rnd(body.totalDailyBill || 0);
  const totalMonthly = electricity + rent + other;
  const costPerBlock = totalBlocks > 0 ? Number((totalMonthly / totalBlocks).toFixed(2)) : 0;
  const grandCostPerBlock = totalBlocks > 0 ? Number(((totalDailyBill + totalMonthly) / totalBlocks).toFixed(2)) : 0;

  const doc = await MonthlyExpense.findOneAndUpdate(
    { userId, month: body.month },
    {
      month: body.month,
      userId,
      electricity,
      rent,
      other,
      totalMonthly,
      totalBlocks,
      totalDailyBill,
      costPerBlock,
      grandCostPerBlock,
    },
    { upsert: true, new: true, runValidators: true }
  );

  return NextResponse.json({ data: doc });
}