import dbConnect from "@/lib/mongodb";
import Customer from "@/models/Customer";
import "@/models/Sale"; // ensure Sale model registered for populate
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CustomerBody = {
  name?: string;
  phone?: string;
  village?: string;
  totalUdhar?: number;
  totalBusiness?: number;
  saleId?: string;
};

type SaleItem = {
  productName?: string;
  name?: string;
  blockName?: string;
  category?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  sellPrice?: number;
  rate?: number;
  total?: number;
};

type PopulatedSale = {
  _id: Types.ObjectId;
  createdAt: Date;
  items?: SaleItem[];
  totalAmount?: number;
};

function rnd(n: number): number { return Math.round(Number(n) || 0); }

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();

    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim() || "";
    const status = sp.get("status") || "pending";
    const userId = new Types.ObjectId(session.user.id);

    let query: Record<string, unknown> = { userId };

    if (status !== "all") {
      query = { ...query, isPaid: status === "paid" };
    }

    if (search) {
      const regex = { $regex: search, $options: "i" };
      const normRegex = { $regex: search.toLowerCase(), $options: "i" };
      query = {
        ...query,
        $or: [{ name: regex }, { normalizedName: normRegex }, { phone: regex }, { village: regex }],
      };
    }

    const customersRaw = await Customer.find(query)
      .populate({
        path: "saleIds",
        model: "Sale",
        select: "items totalAmount createdAt date",
        options: { sort: { createdAt: -1 } },
      })
      .sort({ isPaid: 1, lastUdharDate: -1 })
      .lean();

    const customers = customersRaw.map((c) => {
      const sales = (c.saleIds as unknown as PopulatedSale[]) || [];
      
      // ✅ Flatten all items from all sales - FIX for Rs 0 bug
      const allItems = sales.flatMap((sale) =>
        (sale.items || []).map((it) => {
          const prodName = it.productName || it.name || it.blockName || "Block";
          const qty = it.qty ?? it.quantity ?? 0;
          const price = it.price ?? it.sellPrice ?? it.rate ?? 0;
          const total = it.total ?? rnd(qty * price);
          return {
            productName: prodName,
            category: it.category || (prodName.toLowerCase().includes("block") ? "block" : "other"),
            qty: rnd(qty),
            price: rnd(price),
            total: rnd(total),
            date: sale.createdAt,
          };
        })
      );

      return {
        ...c,
        totalUdhar: rnd(c.totalUdhar),
        totalBusiness: rnd(c.totalBusiness),
        paidAmount: rnd(c.paidAmount),
        billsCount: c.billsCount || sales.length || 1,
        items: allItems, // ✅ Now frontend will get exact product name + price
        saleIds: sales,
      };
    });

    const totalUdharAgg = customers.filter((c) => !c.isPaid).reduce((s, c) => s + c.totalUdhar, 0);

    return NextResponse.json({ customers, totalUdhar: rnd(totalUdharAgg), totalCustomers: customers.length });
  } catch (e) {
    console.error("GET /api/customers error:", e);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const body = (await req.json()) as CustomerBody;

    if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const userId = new Types.ObjectId(session.user.id);
    const trimmedName = body.name.trim();
    const normalized = trimmedName.toLowerCase();
    const total = rnd(body.totalUdhar || 0);
    const totalBiz = rnd(body.totalBusiness || body.totalUdhar || 0);
    const saleObjectId = body.saleId && Types.ObjectId.isValid(body.saleId) ? new Types.ObjectId(body.saleId) : undefined;

    const existing = await Customer.findOne({ userId, normalizedName: normalized, isPaid: false });
    if (existing) {
      existing.totalUdhar = rnd(existing.totalUdhar + total);
      existing.totalBusiness = rnd(existing.totalBusiness + totalBiz);
      if (saleObjectId) {
        if (!existing.saleIds) existing.saleIds = [];
        const already = existing.saleIds.some((id: Types.ObjectId) => id.toString() === saleObjectId.toString());
        if (!already) existing.saleIds.push(saleObjectId);
        existing.billsCount = (existing.billsCount || 0) + 1;
      }
      existing.lastUdharDate = new Date();
      if (body.phone?.trim()) existing.phone = body.phone.trim();
      if (body.village?.trim()) existing.village = body.village.trim();
      await existing.save();
      return NextResponse.json(existing, { status: 200 });
    }

    const cust = await Customer.create({
      name: trimmedName,
      normalizedName: normalized,
      phone: body.phone?.trim() || "",
      village: body.village?.trim() || "",
      totalUdhar: total,
      totalBusiness: totalBiz,
      saleIds: saleObjectId ? [saleObjectId] : [],
      billsCount: saleObjectId ? 1 : 0,
      lastUdharDate: new Date(),
      userId,
      isPaid: false,
      paidAmount: 0,
      wusoolHistory: [],
    });
    return NextResponse.json(cust, { status: 201 });
  } catch (e) {
    console.error("POST /api/customers error:", e);
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
  }
}