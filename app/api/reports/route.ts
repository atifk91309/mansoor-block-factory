import dbConnect from "@/lib/mongodb";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import BlockProduct from "@/models/BlockProduct";
import BlockDaily from "@/models/BlockDaily";
import MonthlyExpense from "@/models/MonthlyExpense";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { Types } from "mongoose";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SaleAgg = {
  count: number; total: number; profit: number;
  profitPositive: number; profitNegative: number;
  cash: number; udhar: number; blockCount: number;
};

type KhataAgg = { totalUdhar: number; count: number };
type StockAgg = { stockValue: number; stockValueSell: number; lowCount: number; totalStock: number };
type DailyAgg = { totalBlocks: number; totalCement: number; totalWages: number; count: number; totalMix: number; totalBill: number };

type SaleMatch = { userId: Types.ObjectId; createdAt?: { $gte: Date; $lt: Date } };
type EmptySale = {
  count: number; total: number; profit: number;
  profitPositive: number; profitNegative: number;
  buy: number; cash: number; credit: number; blockCount: number;
};

function emptySale(): EmptySale {
  return { count: 0, total: 0, profit: 0, profitPositive: 0, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: 0 };
}
function emptyStock(): StockAgg {
  return { stockValue: 0, stockValueSell: 0, lowCount: 0, totalStock: 0 };
}
function emptyDaily(): DailyAgg {
  return { totalBlocks: 0, totalCement: 0, totalWages: 0, count: 0, totalMix: 0, totalBill: 0 };
}

function fmtSale(arr: SaleAgg[]): EmptySale {
  if (!arr?.[0]) return emptySale();
  const r = arr[0];
  const total = Math.round(r.total || 0);
  const profit = Math.round(r.profit || 0);
  return {
    count: r.count || 0, total, profit,
    profitPositive: Math.round(r.profitPositive || 0),
    profitNegative: Math.round(Math.abs(r.profitNegative || 0)),
    buy: Math.max(0, total - profit),
    cash: Math.round(r.cash || 0),
    credit: Math.round(r.udhar || 0),
    blockCount: Math.round(r.blockCount || 0),
  };
}

function fmtStock(arr: StockAgg[]): StockAgg {
  if (!arr?.[0]) return emptyStock();
  const r = arr[0];
  return {
    stockValue: Math.round(r.stockValue || 0),
    stockValueSell: Math.round(r.stockValueSell || 0),
    lowCount: r.lowCount || 0,
    totalStock: Math.round(r.totalStock || 0),
  };
}

function fmtDaily(arr: DailyAgg[]): DailyAgg {
  if (!arr?.[0]) return emptyDaily();
  const r = arr[0];
  return {
    totalBlocks: Math.round(r.totalBlocks || 0),
    totalCement: Math.round(r.totalCement || 0),
    totalWages: Math.round(r.totalWages || 0),
    count: r.count || 0,
    totalMix: Math.round((r as unknown as { totalMix: number }).totalMix || 0),
    totalBill: Math.round((r as unknown as { totalBill: number }).totalBill || 0),
  };
}

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function getPKTRange() {
  const now = new Date();
  const nowPKT = new Date(now.getTime() + PKT_OFFSET_MS);
  const y = nowPKT.getUTCFullYear();
  const m = nowPKT.getUTCMonth();
  const d = nowPKT.getUTCDate();
  const startTodayUTC = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const startTomorrowUTC = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const startMonthUTC = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const startYearUTC = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  return { startTodayUTC, startTomorrowUTC, startMonthUTC, startYearUTC };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({
        today: emptySale(), month: emptySale(), year: emptySale(), all: emptySale(),
        khata: { totalUdhar: 0, customers: 0, totalWusool: 0, wusoolCustomers: 0 },
        stock: emptyStock(),
        production: { today: emptyDaily(), month: emptyDaily(), all: emptyDaily() },
        categoryBreakdown: [], todayRecent: [],
      });
    }

    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const { startTodayUTC, startTomorrowUTC, startMonthUTC, startYearUTC } = getPKTRange();

    const saleAgg = (match: SaleMatch) =>
      Sale.aggregate<SaleAgg>([
        { $match: match as unknown as Record<string, unknown> },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: "$totalSell" },
            profit: { $sum: { $ifNull: ["$totalProfit", 0] } },
            profitPositive: { $sum: { $cond: [{ $gte: ["$totalProfit", 0] }, { $ifNull: ["$totalProfit", 0] }, 0] } },
            profitNegative: { $sum: { $cond: [{ $lt: ["$totalProfit", 0] }, { $ifNull: ["$totalProfit", 0] }, 0] } },
            cash: { $sum: { $cond: [{ $ne: ["$paymentType", "udhar"] }, "$totalSell", 0] } },
            udhar: { $sum: { $cond: [{ $eq: ["$paymentType", "udhar"] }, "$totalSell", 0] } },
            blockCount: { $sum: { $ifNull: ["$totalQuantity", 0] } },
          },
        },
      ]);

    const stockAgg = () =>
      BlockProduct.aggregate<StockAgg>([
        { $match: { userId, stock: { $gte: 0 } } },
        {
          $group: {
            _id: null,
            stockValue: { $sum: { $multiply: ["$stock", { $ifNull: ["$buyPriceAvg", 0] }] } },
            stockValueSell: { $sum: { $multiply: ["$stock", { $ifNull: ["$sellPrice", 0] }] } },
            totalStock: { $sum: "$stock" },
            lowCount: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 10] }, { $ne: ["$stockMode", "unlimited"] }] }, 1, 0] } },
          },
        },
      ]);

    const dailyAgg = (from: Date, to: Date) =>
      BlockDaily.aggregate<DailyAgg>([
        { $match: { userId, date: { $gte: from, $lt: to } } },
        { 
          $group: { 
            _id: null, 
            totalBlocks: { $sum: { $ifNull: ["$blocksCount", 0] } }, 
            totalCement: { $sum: "$cementBags" }, 
            totalWages: { $sum: "$dailyWages" }, 
            count: { $sum: 1 },
            totalMix: { $sum: "$mixCost" },
            totalBill: { $sum: "$totalBill" },
          } 
        },
      ]);

    const allProdAgg = () =>
      BlockDaily.aggregate<DailyAgg>([
        { $match: { userId } }, 
        { 
          $group: { 
            _id: null, 
            totalBlocks: { $sum: { $ifNull: ["$blocksCount", 0] } }, 
            totalCement: { $sum: "$cementBags" }, 
            totalWages: { $sum: "$dailyWages" }, 
            count: { $sum: 1 },
            totalMix: { $sum: "$mixCost" },
            totalBill: { $sum: "$totalBill" },
          } 
        }
      ]);

    const [
      todaySale, monthSale, yearSale, allSale,
      khataAgg, wusoolAgg, stockData,
      todayProd, monthProd, allProd,
      categoryBreakdown, todayRecent, monthlyExp,
    ] = await Promise.all([
      saleAgg({ userId, createdAt: { $gte: startTodayUTC, $lt: startTomorrowUTC } }),
      saleAgg({ userId, createdAt: { $gte: startMonthUTC, $lt: startTomorrowUTC } }),
      saleAgg({ userId, createdAt: { $gte: startYearUTC, $lt: startTomorrowUTC } }),
      saleAgg({ userId }),
      Customer.aggregate<KhataAgg>([{ $match: { userId, isPaid: false, totalUdhar: { $gt: 0.5 } } }, { $group: { _id: null, totalUdhar: { $sum: "$totalUdhar" }, count: { $sum: 1 } } }]),
      Customer.aggregate<KhataAgg>([{ $match: { userId, isPaid: true } }, { $group: { _id: null, totalUdhar: { $sum: "$paidAmount" }, count: { $sum: 1 } } }]),
      stockAgg(),
      dailyAgg(startTodayUTC, startTomorrowUTC),
      dailyAgg(startMonthUTC, startTomorrowUTC),
      allProdAgg(),
      Sale.aggregate([{ $match: { userId } }, { $unwind: "$items" }, { $group: { _id: "$items.category", total: { $sum: { $multiply: ["$items.quantity", "$items.sellPrice"] } }, count: { $sum: 1 }, qty: { $sum: "$items.quantity" } } }, { $sort: { total: -1 } }]),
      Sale.find({ userId, createdAt: { $gte: startTodayUTC, $lt: startTomorrowUTC } }).sort({ createdAt: -1 }).limit(8).lean(),
      MonthlyExpense.find({ userId }).sort({ month: -1 }).lean(),
    ]);

    return NextResponse.json({
      today: fmtSale(todaySale),
      month: fmtSale(monthSale),
      year: fmtSale(yearSale),
      all: fmtSale(allSale),
      khata: {
        totalUdhar: Math.round(khataAgg[0]?.totalUdhar || 0),
        customers: khataAgg[0]?.count || 0,
        totalWusool: Math.round(wusoolAgg[0]?.totalUdhar || 0),
        wusoolCustomers: wusoolAgg[0]?.count || 0,
      },
      stock: fmtStock(stockData),
      production: {
        today: fmtDaily(todayProd),
        month: fmtDaily(monthProd),
        all: fmtDaily(allProd),
      },
      categoryBreakdown,
      todayRecent,
      monthlyExpenses: monthlyExp,
    });
  } catch (err) {
    console.error("GET /api/reports error:", err);
    return NextResponse.json({
      today: emptySale(), month: emptySale(), year: emptySale(), all: emptySale(),
      khata: { totalUdhar: 0, customers: 0, totalWusool: 0, wusoolCustomers: 0 },
      stock: emptyStock(),
      production: { today: emptyDaily(), month: emptyDaily(), all: emptyDaily() },
      categoryBreakdown: [], todayRecent: [],
    });
  }
}