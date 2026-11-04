import dbConnect from "@/lib/mongodb";
import BlockProduct from "@/models/BlockProduct";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import { TrolleyEntryModel, TrolleyStockModel } from "@/models/TrolleyStock";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SaleItemInput = {
  productId?: string;
  trolleyEntryId?: string;
  productName?: string;
  category?: string;
  source?: "block_product" | "trolley";
  quantity: number;
  rairiQty?: number;
  sellPrice: number;
  buyPrice?: number;
  buyPriceAvg?: number;
};

type SaleBody = {
  items?: SaleItemInput[];
  productId?: string;
  quantity?: number;
  sellPrice?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  productName?: string;
  category?: string;
  customerName?: string;
  phone?: string;
  village?: string;
  paymentType?: "cash" | "udhar" | "credit";
  invoiceNo?: string;
  date?: string;
  localId?: string;
  userId?: string;
};

type SaleQuery = {
  userId: Types.ObjectId;
  createdAt?: { $gte: Date; $lt: Date };
  paymentType?: string;
  isUdhar?: boolean;
  $or?: Array<Record<string, unknown>>;
  "items.category"?: string;
};

function rnd(n: number): number { return Math.round(Number(n) || 0); }

function getDateRange(filter: string): { start: Date; end: Date } | null {
  if (filter === "all") return null;
  const pktOffset = 5 * 60 * 60 * 1000;
  const now = new Date();
  const nowPKT = new Date(now.getTime() + pktOffset);
  const y = nowPKT.getUTCFullYear();
  const m = nowPKT.getUTCMonth();
  const d = nowPKT.getUTCDate();
  const startToday = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - pktOffset);
  const endToday = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0) - pktOffset);
  if (filter === "today") return { start: startToday, end: endToday };
  if (filter === "yesterday") {
    const s = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0) - pktOffset);
    const e = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - pktOffset);
    return { start: s, end: e };
  }
  if (filter === "weekly") return { start: new Date(startToday.getTime() - 7 * 24 * 60 * 60 * 1000), end: endToday };
  if (filter === "monthly") return { start: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - pktOffset), end: endToday };
  if (filter === "yearly") return { start: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0) - pktOffset), end: endToday };
  return { start: startToday, end: endToday };
}

async function recalcTrolleyStock(userId: Types.ObjectId): Promise<void> {
  const all = await TrolleyEntryModel.find({ userId }).lean() as unknown as Array<{
    normalizedMaterial: string; material: string;
    rairiInTrolley: number; actualRairi?: number;
    totalUsed?: number; perRairiRate?: number;
  }>;
  const map = new Map<string, { rairi: number; cost: number; name: string }>();
  for (const e of all) {
    const norm = String(e.normalizedMaterial || "").toLowerCase().trim();
    if (!norm) continue;
    const eff = rnd(e.actualRairi ?? e.rairiInTrolley);
    const rem = Math.max(0, eff - rnd(e.totalUsed ?? 0));
    const cur = map.get(norm) ?? { rairi: 0, cost: 0, name: e.material };
    cur.rairi += rem;
    cur.cost += rem * Number(e.perRairiRate ?? 0);
    map.set(norm, cur);
  }
  for (const [norm, v] of map) {
    const avg = v.rairi > 0 ? Number((v.cost / v.rairi).toFixed(2)) : 0;
    await TrolleyStockModel.updateOne(
      { userId, normalizedMaterial: norm },
      { $set: { material: v.name, totalRairi: rnd(v.rairi), totalCost: rnd(v.cost), avgRate: avg, updatedAt: new Date() },
        $setOnInsert: { localId: `stock_${norm}`, userId } },
      { upsert: true }
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ sales: [], total: 0, profit: 0, pagination: { page: 1, totalPages: 1, hasMore: false, totalCount: 0 } });
    }
    await dbConnect();
    const sp = req.nextUrl.searchParams;
    const filter = sp.get("filter") || "today";
    const search = sp.get("search")?.trim() || "";
    const category = sp.get("category") || "";
    const rawPaymentType = sp.get("paymentType") || sp.get("type") || "";
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;
    const userId = new Types.ObjectId(session.user.id);
    const range = getDateRange(filter);
    const q: SaleQuery = { userId };
    if (range) q.createdAt = { $gte: range.start, $lt: range.end };
    if (search) {
      q.$or = [
        { invoiceNo: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { "items.productName": { $regex: search, $options: "i" } },
      ];
    }
    if (category && category !== "all") q["items.category"] = category;
    if (rawPaymentType && rawPaymentType !== "all") {
      if (rawPaymentType === "udhar" || rawPaymentType === "credit") {
        q.paymentType = "udhar"; q.isUdhar = true;
      } else if (rawPaymentType === "cash") q.paymentType = "cash";
    }
    const [sales, totalCount, agg] = await Promise.all([
      Sale.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(q),
      Sale.aggregate([{ $match: q as Record<string, unknown> }, { $group: { _id: null, total: { $sum: "$totalSell" }, profit: { $sum: "$totalProfit" } } }]),
    ]);
    const firstAgg = agg[0] as { total?: number; profit?: number } | undefined;
    return NextResponse.json({
      sales,
      total: rnd(firstAgg?.total || 0),
      profit: rnd(firstAgg?.profit || 0),
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit), hasMore: skip + sales.length < totalCount },
    });
  } catch (e) {
    console.error("GET /api/sales error:", e);
    return NextResponse.json({ sales: [], total: 0, profit: 0, pagination: { page: 1, totalPages: 1, hasMore: false, totalCount: 0 } });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    await dbConnect();
    const body = (await req.json()) as SaleBody;

    let userId: Types.ObjectId;
    if (session?.user?.id && Types.ObjectId.isValid(session.user.id)) userId = new Types.ObjectId(session.user.id);
    else if (body.userId && Types.ObjectId.isValid(body.userId)) userId = new Types.ObjectId(body.userId);
    else return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (body.localId) {
      const exists = await Sale.findOne({ localId: body.localId, userId }).lean();
      if (exists) return NextResponse.json(exists, { status: 200 });
    }

    let itemsInput: SaleItemInput[] = [];
    if (body.items && body.items.length > 0) itemsInput = body.items;
    else if (body.productId && body.quantity) {
      itemsInput = [{ productId: body.productId, productName: body.productName, category: body.category, quantity: body.quantity, sellPrice: body.sellPrice || 0, buyPrice: body.buyPrice, buyPriceAvg: body.buyPriceAvg }];
    } else return NextResponse.json({ error: "items required" }, { status: 400 });

    // STEP 1: Validate stock - No batch filter
    const productsToDeduct: Array<{ _id: Types.ObjectId; qty: number }> = [];
    const trolleyToDeduct: Array<{ localId: string; rairi: number }> = [];
    
    for (const it of itemsInput) {
      if (it.source === "trolley" && it.trolleyEntryId) {
        const entry = await TrolleyEntryModel.findOne({ localId: it.trolleyEntryId, userId }).lean() as unknown as { rairiInTrolley: number; actualRairi?: number; totalUsed: number; perRairiRate: number } | null;
        if (!entry) return NextResponse.json({ error: `Trolley entry not found` }, { status: 400 });
        const remaining = (entry.actualRairi ?? entry.rairiInTrolley) - (entry.totalUsed ?? 0);
        if (remaining < rnd(it.rairiQty || it.quantity)) {
          return NextResponse.json({ error: `Only ${remaining} Rairi left` }, { status: 400 });
        }
        trolleyToDeduct.push({ localId: it.trolleyEntryId, rairi: rnd(it.rairiQty || it.quantity) });
      } else if (it.productId && Types.ObjectId.isValid(it.productId)) {
        const prod = await BlockProduct.findOne({ _id: it.productId, userId }).lean();
        if (!prod) continue;
        if (prod.stockMode === "limited" && prod.stock < rnd(it.quantity)) {
          return NextResponse.json({ error: `Only ${prod.stock} left for ${prod.name}` }, { status: 400 });
        }
        if (prod.stockMode === "limited") productsToDeduct.push({ _id: prod._id as Types.ObjectId, qty: rnd(it.quantity) });
      }
    }

    const finalItems: Array<{
      productId?: Types.ObjectId;
      trolleyEntryId?: string;
      productName: string;
      category: string;
      source: string;
      quantity: number;
      rairiQty: number;
      sellPrice: number;
      buyPrice: number;
      totalSell: number;
      totalProfit: number;
    }> = [];

    let totalQuantity = 0, totalRairi = 0, totalSell = 0, totalBuy = 0, totalProfit = 0;

    for (const it of itemsInput) {
      const qty = rnd(it.quantity);
      const rairiQty = rnd(it.rairiQty || 0);
      if (qty <= 0 && rairiQty <= 0) continue;
      
      let productName = it.productName || "Block";
      let productCategory = it.category || "block";
      let buyPrice = rnd(it.buyPriceAvg || it.buyPrice || 0);
      const sellPrice = rnd(it.sellPrice);
      const source = it.source || (it.trolleyEntryId ? "trolley" : "block_product");

      if (source === "trolley" && it.trolleyEntryId) {
        const entry = await TrolleyEntryModel.findOne({ localId: it.trolleyEntryId, userId }).lean() as unknown as { material: string } | null;
        if (entry) productName = entry.material;
        productCategory = "other";
      } else if (it.productId && Types.ObjectId.isValid(it.productId)) {
        const prod = await BlockProduct.findOne({ _id: it.productId, userId }).lean();
        if (prod) {
          productName = prod.name;
          productCategory = prod.category;
          if (!it.buyPrice && !it.buyPriceAvg) buyPrice = rnd(prod.buyPriceAvg || prod.buyPrice);
        }
      }

      const itemTotalSell = source === "trolley" ? rnd(sellPrice * (rairiQty || qty)) : rnd(sellPrice * qty);
      const itemTotalBuy = rnd(buyPrice * (rairiQty || qty));
      
      totalQuantity += qty;
      totalRairi += rairiQty;
      totalSell += itemTotalSell;
      totalBuy += itemTotalBuy;
      totalProfit += rnd(itemTotalSell - itemTotalBuy);

      finalItems.push({
        productId: it.productId && Types.ObjectId.isValid(it.productId) ? new Types.ObjectId(it.productId) : undefined,
        trolleyEntryId: it.trolleyEntryId,
        productName,
        category: productCategory,
        source,
        quantity: qty,
        rairiQty: rairiQty,
        sellPrice,
        buyPrice,
        totalSell: itemTotalSell,
        totalProfit: rnd(itemTotalSell - itemTotalBuy),
      });
    }

    if (finalItems.length === 0) return NextResponse.json({ error: "No valid items" }, { status: 400 });

    const isUdhar = body.paymentType === "udhar" || body.paymentType === "credit";
    const customerName = body.customerName?.trim() || "Walk-in";
    if (isUdhar && customerName.toLowerCase() === "walk-in") {
      return NextResponse.json({ error: "Customer name required for Udhar" }, { status: 400 });
    }

    let invoiceNo = body.invoiceNo;
    if (!invoiceNo) {
      const count = await Sale.countDocuments({ userId });
      const year = new Date().getFullYear();
      invoiceNo = `INV-${year}-${String(count + 1).padStart(4, "0")}`;
    }

    const saleDate = body.date ? new Date(body.date) : new Date();

    const sale = await Sale.create({
      invoiceNo,
      customerName,
      customerPhone: body.phone || "",
      village: body.village || "",
      items: finalItems,
      totalQuantity: rnd(totalQuantity),
      totalRairi: rnd(totalRairi),
      totalSell: rnd(totalSell),
      totalBuy: rnd(totalBuy),
      totalProfit: rnd(totalProfit),
      paymentType: isUdhar ? "udhar" : "cash",
      isUdhar,
      date: saleDate,
      userId,
      localId: body.localId || `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    });

    for (const p of productsToDeduct) {
      await BlockProduct.findByIdAndUpdate(p._id, { $inc: { stock: -p.qty } });
    }
    for (const t of trolleyToDeduct) {
      await TrolleyEntryModel.updateOne({ localId: t.localId, userId }, { $inc: { totalUsed: t.rairi } });
    }
    if (trolleyToDeduct.length > 0) await recalcTrolleyStock(userId);

    if (isUdhar) {
      const norm = customerName.toLowerCase();
      await Customer.findOneAndUpdate(
        { userId, normalizedName: norm, isPaid: false },
        {
          $setOnInsert: {
            name: customerName,
            normalizedName: norm,
            phone: body.phone || "",
            village: body.village || "",
            userId,
            paidAmount: 0,
            wusoolHistory: [],
            localId: `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          },
          $inc: { totalUdhar: rnd(totalSell), totalBusiness: rnd(totalSell), billsCount: 1 },
          $set: { lastUdharDate: new Date() },
          $addToSet: { saleIds: sale._id },
        },
        { upsert: true, new: true }
      );
    }

    return NextResponse.json(sale, { status: 201 });
  } catch (e) {
    console.error("POST /api/sales error:", e);
    return NextResponse.json({ error: "Failed to create sale" }, { status: 500 });
  }
}