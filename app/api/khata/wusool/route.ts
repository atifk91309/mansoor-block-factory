import dbConnect from "@/lib/mongodb";
import Customer from "@/models/Customer";
import Sale from "@/models/Sale";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WusoolBody = {
  customerId?: string;
  customerName?: string;
  amount: number;
  note?: string;
  date?: string;
  localId?: string;
};

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const body = (await req.json()) as WusoolBody;
    const amount = rnd(Number(body.amount));

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Valid amount required" }, { status: 400 });
    }
    if (!body.customerId && !body.customerName) {
      return NextResponse.json({ error: "customerId or customerName required" }, { status: 400 });
    }

    // ✅ FIX: userId is ObjectId in your Customer model
    const userId = new Types.ObjectId(session.user.id);

    let customer = null;
    if (body.customerId && Types.ObjectId.isValid(body.customerId)) {
      customer = await Customer.findOne({ _id: body.customerId, userId, isPaid: false });
    } else if (body.customerName) {
      const normalized = body.customerName.trim().toLowerCase();
      customer = await Customer.findOne({ normalizedName: normalized, userId, isPaid: false });
    }

    if (!customer) {
      return NextResponse.json({ error: "Khata not found or already paid" }, { status: 404 });
    }

    const historyEntry = {
      amount,
      date: body.date ? new Date(body.date) : new Date(),
      note: body.note?.trim() || "",
      // localId removed - not in WusoolHistorySchema, will be stripped
    };

    const newUdhar = rnd(customer.totalUdhar - amount);

    if (newUdhar <= 0) {
      // Fully paid
      customer.totalUdhar = 0;
      customer.isPaid = true;
      customer.paidAmount = rnd(customer.totalBusiness);
      customer.paidAt = new Date();
      customer.lastWusoolDate = new Date();
      customer.wusoolHistory.push(historyEntry);
      await customer.save();

      if (customer.saleIds && customer.saleIds.length > 0) {
        // ✅ FIX: Typed id param - 0 any
      const saleObjectIds = customer.saleIds
        .map((id: Types.ObjectId | string) => (typeof id === "string" ? id : id.toString()))
        .filter((id: string) => Types.ObjectId.isValid(id))
        .map((id: string) => new Types.ObjectId(id));

        if (saleObjectIds.length > 0) {
          await Sale.updateMany(
            { _id: { $in: saleObjectIds }, userId },
            { $set: { status: "paid", paymentType: "cash", isCredit: false } }
          );
        }
      }

      return NextResponse.json({
        success: true,
        fullyPaid: true,
        extra: rnd(Math.abs(newUdhar)),
        customer: {
          ...customer.toObject(),
          totalUdhar: 0,
          paidAmount: rnd(customer.totalBusiness),
        },
        wusool: historyEntry,
      });
    } else {
      // Partial wusool
      customer.totalUdhar = newUdhar;
      customer.paidAmount = rnd((customer.paidAmount || 0) + amount);
      customer.lastWusoolDate = new Date();
      customer.wusoolHistory.push(historyEntry);
      await customer.save();

      return NextResponse.json({
        success: true,
        fullyPaid: false,
        remaining: newUdhar,
        customer: {
          ...customer.toObject(),
          totalUdhar: newUdhar,
        },
        wusool: historyEntry,
      });
    }
  } catch (e) {
    console.error("POST /api/khata/wusool error:", e);
    return NextResponse.json({ error: "Failed to record wusool" }, { status: 500 });
  }
}