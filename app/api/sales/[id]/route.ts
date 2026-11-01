import dbConnect from "@/lib/mongodb";
import BlockProduct from "@/models/BlockProduct";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type SaleUpdateBody = {
  quantity?: number;
  sellPrice?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  customerName?: string;
  paymentType?: "cash" | "udhar" | "credit";
  invoiceNo?: string;
  date?: string;
  items?: Array<{
    productId?: string;
    quantity?: number;
    sellPrice?: number;
    buyPrice?: number;
  }>;
};

function isValidObjectId(id: string): boolean { return Types.ObjectId.isValid(id); }
function rnd(n: number): number { return Math.round(Number(n) || 0); }

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params; // ✅ Next.js 15
  if (!isValidObjectId(id) && id.length < 10) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    let sale = null;
    if (isValidObjectId(id)) sale = await Sale.findOne({ _id: id, userId }).lean();
    if (!sale) sale = await Sale.findOne({ localId: id, userId }).lean();
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    return NextResponse.json({ sale, data: sale });
  } catch {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params; // ✅ Next.js 15
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const body = (await req.json()) as SaleUpdateBody;

    const sale = await Sale.findOne({ _id: id, userId });
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

    const oldTotal = rnd(sale.totalSell);
    const oldItems = sale.items;

    // ✅ Support multi-item update
    if (body.items && body.items.length > 0) {
      for (let i = 0; i < body.items.length && i < oldItems.length; i++) {
        const newIt = body.items[i];
        const oldIt = oldItems[i];
        const newQty = rnd(newIt.quantity ?? oldIt.quantity);
        if (newQty <= 0) continue;

        const diff = rnd(newQty - rnd(oldIt.quantity));
        if (diff !== 0 && oldIt.productId) {
          const prod = await BlockProduct.findOne({ _id: oldIt.productId, userId });
          if (prod && prod.stockMode === "limited") {
            if (diff > 0 && prod.stock < diff) {
              return NextResponse.json({ error: `Only ${prod.stock} left for ${prod.name}` }, { status: 400 });
            }
            prod.stock = rnd(prod.stock - diff);
            await prod.save();
          }
        }
        oldIt.quantity = newQty;
        if (newIt.sellPrice !== undefined) oldIt.sellPrice = rnd(newIt.sellPrice);
        if (newIt.buyPrice !== undefined) oldIt.buyPrice = rnd(newIt.buyPrice);
      }
    } else {
      // Old single-item format
      const firstItem = sale.items[0];
      if (!firstItem) return NextResponse.json({ error: "No items" }, { status: 400 });
      let newQty = rnd(firstItem.quantity);
      let newSellPrice = rnd(firstItem.sellPrice);
      let newBuyPrice = rnd(firstItem.buyPrice);

      if (body.quantity !== undefined) newQty = rnd(body.quantity);
      if (body.sellPrice !== undefined) newSellPrice = rnd(body.sellPrice);
      if (body.buyPrice !== undefined || body.buyPriceAvg !== undefined) newBuyPrice = rnd(body.buyPriceAvg ?? body.buyPrice ?? newBuyPrice);

      if (newQty <= 0) return NextResponse.json({ error: "Quantity must be > 0" }, { status: 400 });

      const diff = rnd(newQty - rnd(firstItem.quantity));
      if (firstItem.productId) {
        const product = await BlockProduct.findOne({ _id: firstItem.productId, userId });
        if (product && product.stockMode === "limited") {
          if (diff > 0 && product.stock < diff) {
            return NextResponse.json({ error: `Only ${product.stock} left, need ${diff} more` }, { status: 400 });
          }
          if (diff !== 0) {
            product.stock = rnd(product.stock - diff);
            await product.save();
          }
        }
      }
      firstItem.quantity = newQty;
      firstItem.sellPrice = newSellPrice;
      firstItem.buyPrice = newBuyPrice;
    }

    // Recalc totals 
      sale.totalQuantity = sale.items.reduce((s: number, it: { quantity: number }) => s + rnd(it.quantity), 0);
      sale.totalSell = sale.items.reduce((s: number, it: { sellPrice: number; quantity: number }) => s + rnd(it.sellPrice * it.quantity), 0);
      sale.totalProfit = sale.items.reduce((s: number, it: { sellPrice: number; buyPrice: number; quantity: number }) => s + rnd((it.sellPrice - it.buyPrice) * it.quantity), 0);

    if (body.customerName) sale.customerName = body.customerName.trim();
    if (body.invoiceNo) sale.invoiceNo = body.invoiceNo.trim();
    if (body.date) sale.date = new Date(body.date);
    if (body.paymentType) {
      const isUdhar = body.paymentType === "udhar" || body.paymentType === "credit";
      sale.paymentType = isUdhar ? "udhar" : "cash";
      sale.isUdhar = isUdhar;
    }

    await sale.save();

    if (sale.isUdhar) {
      const totalDiff = rnd(sale.totalSell - oldTotal);
      if (totalDiff !== 0) {
        await Customer.findOneAndUpdate(
          { userId, saleIds: sale._id, isPaid: false },
          { $inc: { totalUdhar: totalDiff, totalBusiness: totalDiff }, $set: { lastUdharDate: new Date() } }
        );
      }
      if (body.customerName) {
        await Customer.findOneAndUpdate(
          { userId, saleIds: sale._id, isPaid: false },
          { $set: { name: body.customerName.trim(), normalizedName: body.customerName.trim().toLowerCase() } }
        );
      }
    }

    return NextResponse.json({ sale, product: sale });
  } catch (e) {
    console.error("PUT /api/sales/[id] error:", e);
    return NextResponse.json({ error: "Failed to update sale" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params; // ✅ Next.js 15
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);

    let saleDoc = null;
    if (isValidObjectId(id)) saleDoc = await Sale.findOne({ _id: id, userId });
    if (!saleDoc) saleDoc = await Sale.findOne({ localId: id, userId });
    if (!saleDoc) return NextResponse.json({ ok: true, message: "Already deleted" });

    // ✅ Restore stock for all items
    for (const item of saleDoc.items) {
      try {
        if (item.productId) {
          const prod = await BlockProduct.findOne({ _id: item.productId, userId });
          if (prod && prod.stockMode === "limited") {
            prod.stock = rnd(prod.stock + rnd(item.quantity));
            await prod.save();
          }
        }
      } catch {}
    }

    if (saleDoc.isUdhar) {
      const updated = await Customer.findOneAndUpdate(
        { userId, saleIds: saleDoc._id, isPaid: false },
        { $inc: { totalUdhar: -rnd(saleDoc.totalSell), totalBusiness: -rnd(saleDoc.totalSell), billsCount: -1 }, $pull: { saleIds: saleDoc._id } },
        { new: true }
      );
      if (updated && (updated.totalUdhar <= 0.5 || updated.billsCount <= 0)) {
        await Customer.deleteOne({ _id: updated._id });
      }
    }

    await Sale.deleteOne({ _id: saleDoc._id, userId });
    return NextResponse.json({ success: true, message: "Sale deleted, stock restored - Mansoor Factory", restored: rnd(saleDoc.totalQuantity), invoiceNo: saleDoc.invoiceNo });
  } catch (e) {
    console.error("DELETE /api/sales/[id] error:", e);
    return NextResponse.json({ error: "Failed to delete sale" }, { status: 500 });
  }
}