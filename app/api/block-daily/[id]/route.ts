import connectDB from "@/lib/mongodb";
import BlockDaily from "@/models/BlockDaily";
import BlockProduct from "@/models/BlockProduct";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function rnd(n: number) { return Math.round(Number(n) || 0); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const daily = await BlockDaily.findOne({ _id: id, userId: session.user.id }).lean();
    if (!daily) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(daily);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const daily = await BlockDaily.findOne({ _id: id, userId: session.user.id });
    if (!daily) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // ✅ Revert stock safely
    const existing = await BlockProduct.findOne({ 
      userId: session.user.id, 
      name: { $regex: `^${daily.blocksMade.trim()}$`, $options: 'i' } 
    });
    if (existing) {
      const newStock = Math.max(0, rnd(existing.stock) - rnd(daily.blocksCount));
      await BlockProduct.updateOne({ _id: existing._id }, { $set: { stock: newStock } });
    }

    await BlockDaily.deleteOne({ _id: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB();
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const body = await req.json();
    const old = await BlockDaily.findOne({ _id: id, userId: session.user.id });
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const newCount = rnd(body.blocksCount ?? old.blocksCount);
    const newName = body.blocksMade?.trim() || old.blocksMade;
    const diff = newCount - rnd(old.blocksCount);
    const isNameChanged = newName.toLowerCase() !== old.blocksMade.toLowerCase();

    const updated = await BlockDaily.findOneAndUpdate(
      { _id: id },
      { 
        blocksMade: newName,
        blocksCount: newCount,
        cementBags: body.cementBags !== undefined ? rnd(body.cementBags) : old.cementBags,
        ratePerBlock: body.ratePerBlock !== undefined ? rnd(body.ratePerBlock) : old.ratePerBlock,
        dailyWages: rnd(newCount * (body.ratePerBlock ?? old.ratePerBlock)),
        blockType: body.blockType || old.blockType,
        date: body.date ? new Date(body.date) : old.date,
      },
      { new: true }
    );

    // ✅ FIXED stock logic
    if (isNameChanged) {
      // Remove from old product, add to new product
      const oldProd = await BlockProduct.findOne({ userId: session.user.id, name: { $regex: `^${old.blocksMade}$`, $options: 'i' } });
      const newProd = await BlockProduct.findOne({ userId: session.user.id, name: { $regex: `^${newName}$`, $options: 'i' } });
      
      if (oldProd) await BlockProduct.updateOne({ _id: oldProd._id }, { $inc: { stock: -rnd(old.blocksCount) } });
      if (newProd) await BlockProduct.updateOne({ _id: newProd._id }, { $inc: { stock: newCount } });
    } else if (diff !== 0) {
      // Same block, just count diff
      const prod = await BlockProduct.findOne({ userId: session.user.id, name: { $regex: `^${old.blocksMade}$`, $options: 'i' } });
      if (prod) await BlockProduct.updateOne({ _id: prod._id }, { $inc: { stock: diff } });
    }

    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}