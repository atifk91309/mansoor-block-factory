import connectDB from "@/lib/mongodb";
import BlockDaily from "@/models/BlockDaily";
import BlockProduct from "@/models/BlockProduct";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BillBody = { label: string; amount: number };
type MixBody = { label: string; qty: string };

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
  } catch {
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
    
    const body = await req.json() as {
      blocksMade?: string;
      blocksCount?: number;
      cementBags?: number;
      ratePerBlock?: number;
      blockType?: string;
      date?: string;
      bills?: BillBody[];
      mixMaterials?: MixBody[];
      isMonthlyElectricity?: boolean;
    };

    const old = await BlockDaily.findOne({ _id: id, userId: session.user.id });
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const newCount = rnd(body.blocksCount ?? old.blocksCount);
    const newName = body.blocksMade?.trim() || old.blocksMade;
    const diff = newCount - rnd(old.blocksCount);
    const isNameChanged = newName.toLowerCase() !== old.blocksMade.toLowerCase();
    const newRate = rnd(body.ratePerBlock ?? old.ratePerBlock);

    // Clean dynamic fields
    const cleanBills: BillBody[] = (body.bills ?? old.bills ?? [])
      .filter(b => b.label && b.label.trim().length > 0)
      .map(b => ({ label: b.label.trim(), amount: rnd(b.amount || 0) }));

    const cleanMix: MixBody[] = (body.mixMaterials ?? old.mixMaterials ?? [])
      .filter(m => m.label && m.label.trim().length > 0)
      .map(m => ({ label: m.label.trim(), qty: m.qty ? m.qty.trim() : "" }));

    const extraBills = cleanBills.reduce((sum, b) => {
      if (b.label.toLowerCase().includes("labour")) return sum;
      return sum + (b.amount || 0);
    }, 0);
    const newWages = rnd(newCount * newRate);
    const totalBill = newWages + extraBills;

    const updated = await BlockDaily.findOneAndUpdate(
      { _id: id },
      { 
        blocksMade: newName,
        blocksCount: newCount,
        cementBags: body.cementBags !== undefined ? rnd(body.cementBags) : old.cementBags,
        ratePerBlock: newRate,
        dailyWages: newWages,
        blockType: body.blockType || old.blockType,
        date: body.date ? new Date(body.date) : old.date,
        bills: cleanBills,
        mixMaterials: cleanMix,
        totalBill,
        costPerBlock: newCount > 0 ? Math.round((totalBill / newCount) * 10) / 10 : 0,
        isMonthlyElectricity: body.isMonthlyElectricity ?? old.isMonthlyElectricity ?? false,
      },
      { new: true }
    );

    // Stock logic
    if (isNameChanged) {
      const oldProd = await BlockProduct.findOne({ userId: session.user.id, name: { $regex: `^${old.blocksMade}$`, $options: 'i' } });
      const newProd = await BlockProduct.findOne({ userId: session.user.id, name: { $regex: `^${newName}$`, $options: 'i' } });
      
      if (oldProd) await BlockProduct.updateOne({ _id: oldProd._id }, { $inc: { stock: -rnd(old.blocksCount) } });
      if (newProd) await BlockProduct.updateOne({ _id: newProd._id }, { $inc: { stock: newCount } });
    } else if (diff !== 0) {
      const prod = await BlockProduct.findOne({ userId: session.user.id, name: { $regex: `^${old.blocksMade}$`, $options: 'i' } });
      if (prod) await BlockProduct.updateOne({ _id: prod._id }, { $inc: { stock: diff } });
    }

    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}