import dbConnect from "@/lib/mongodb";
import Customer from "@/models/Customer";
import Sale from "@/models/Sale";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

type LeanSale = {
  _id: Types.ObjectId;
  productName: string;
  productId?: Types.ObjectId;
  category?: string;
  quantity: number;
  sellPrice: number;
  total: number;
  profit: number;
  createdAt: Date;
  status?: string;
};

function rnd(n: number): number { return Math.round(Number(n) || 0); }

function getUnitLabel(name: string, cat?: string): string {
  const n = name.toLowerCase();
  const c = (cat || "").toLowerCase();
  if (c === "block" || n.includes("block") || n.includes("khahta") || n.includes("shaga") || n.includes("slim") || n.includes("concar")) {
    return "Block";
  }
  return "trolly";
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();
    const { id } = await params;
    if (!id || !Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const userId = new Types.ObjectId(session.user.id);
    const customer = await Customer.findOne({ _id: id, userId }).lean();
    if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const saleIds = customer.saleIds || [];
    const sales = (saleIds.length > 0 ? await Sale.find({ _id: { $in: saleIds } }).sort({ createdAt: 1 }).lean() : []) as unknown as LeanSale[];

    const bills = sales.map((s) => ({
      _id: s._id.toString(),
      productName: s.productName,
      productId: s.productId?.toString(),
      category: s.category || "",
      quantity: rnd(s.quantity),
      sellPrice: rnd(s.sellPrice),
      total: rnd(s.total),
      profit: rnd(s.profit),
      createdAt: s.createdAt,
      status: s.status || "completed",
      unitLabel: getUnitLabel(s.productName, s.category), // ✅ FIX: Block vs trolly
    }));

    return NextResponse.json({
      customer: {
        ...customer,
        totalUdhar: rnd(customer.totalUdhar),
        totalBusiness: rnd(customer.totalBusiness),
        paidAmount: rnd(customer.paidAmount),
        billsCount: customer.billsCount || bills.length,
      },
      bills,
    });
  } catch (e) {
    console.error("GET /api/customers/[id] error:", e);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await dbConnect();
    const { id } = await params;
    if (!id || !Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const userId = new Types.ObjectId(session.user.id);
    const customer = await Customer.findOne({ _id: id, userId });
    if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Optional: delete related sales too to keep stock clean
    // Comment out if you want to keep sales history
    if (customer.saleIds?.length > 0) {
      await Sale.deleteMany({ _id: { $in: customer.saleIds }, userId });
    }

    await Customer.deleteOne({ _id: customer._id });

    return NextResponse.json({
      success: true,
      deletedId: id,
      deletedName: customer.name,
      deletedBillsCount: customer.billsCount,
    });
  } catch (e) {
    console.error("DELETE /api/customers/[id] error:", e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}