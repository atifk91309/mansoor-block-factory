import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Easypaisa from "@/models/Easypaisa";
import Customer from "@/models/Customer";
import { Types } from "mongoose";

type BackupBase = {
  _id?: string;
  localId?: string;
  userId?: string | Types.ObjectId;
  name?: string;
};

type BackupProduct = BackupBase & {
  stock?: number;
  buyPrice?: number;
  sellPrice?: number;
  category?: string;
  stockMode?: string;
  buyPriceAvg?: number;
};

type BackupSale = BackupBase & {
  total?: number;
  profit?: number;
  productName?: string;
  __v?: number;
};

type BackupEasy = BackupBase & {
  amount?: number;
  commission?: number;
  __v?: number;
};

type BackupCustomer = BackupBase & {
  normalizedName?: string;
  totalBusiness?: number;
  totalUdhar?: number;
  paidAmount?: number;
  saleIds?: (string | Types.ObjectId)[];
  billsCount?: number;
  wusoolHistory?: { amount: number; date?: string }[];
  isPaid?: boolean;
};

type RestorePayload = {
  data?: {
    products?: BackupProduct[];
    sales?: BackupSale[];
    easypaisa?: BackupEasy[];
    customers?: BackupCustomer[];
  };
  products?: BackupProduct[];
  sales?: BackupSale[];
  easypaisa?: BackupEasy[];
  customers?: BackupCustomer[];
};

type RestoredCount = { products: number; sales: number; easypaisa: number; customers: number };

function getUserIdString(item: BackupBase): string | undefined {
  if (!item.userId) return undefined;
  return item.userId.toString();
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = (await req.json()) as RestorePayload;
    const src = body.data ? body.data : body;

    const products = src.products ?? [];
    const sales = src.sales ?? [];
    const easypaisa = src.easypaisa ?? [];
    const customers = src.customers ?? [];

    const restored: RestoredCount = { products: 0, sales: 0, easypaisa: 0, customers: 0 };
    const skipped: RestoredCount = { products: 0, sales: 0, easypaisa: 0, customers: 0 };

    // 1. PRODUCTS
    for (const p of products) {
      const userIdStr = getUserIdString(p);
      const nameVal = p.name;
      let exists = null;

      try {
        if (p._id && Types.ObjectId.isValid(p._id)) {
          exists = await Product.findById(p._id).lean();
        }
      } catch { /* ignore */ }

      if (!exists && p.localId && userIdStr) {
        exists = await Product.findOne({ localId: p.localId, userId: userIdStr }).lean();
      }
      if (!exists && nameVal && userIdStr) {
        exists = await Product.findOne({ name: nameVal, userId: userIdStr }).lean();
      }

      if (!exists) {
        try {
          const { _id, ...rest } = p;
          void _id;
          await Product.create(rest);
          restored.products++;
        } catch {
          skipped.products++;
        }
      } else {
        skipped.products++;
      }
    }

    // 2. SALES
    for (const s of sales) {
      let exists = null;
      try {
        if (s._id && Types.ObjectId.isValid(s._id)) {
          exists = await Sale.findById(s._id).lean();
        }
      } catch { /* ignore */ }

      if (!exists && s.localId) {
        const uid = getUserIdString(s);
        if (uid) exists = await Sale.findOne({ localId: s.localId, userId: uid }).lean();
      }

      if (!exists) {
        try {
          const { _id, __v, ...rest } = s as BackupSale & { _id?: string; __v?: number };
          void _id; void __v;
          await Sale.create(rest);
          restored.sales++;
        } catch {
          skipped.sales++;
        }
      } else {
        skipped.sales++;
      }
    }

    // 3. EASYPAISA
    for (const e of easypaisa) {
      let exists = null;
      try {
        if (e._id && Types.ObjectId.isValid(e._id)) {
          exists = await Easypaisa.findById(e._id).lean();
        }
      } catch { /* ignore */ }

      if (!exists && e.localId) {
        const uid = getUserIdString(e);
        if (uid) exists = await Easypaisa.findOne({ localId: e.localId, userId: uid }).lean();
      }

      if (!exists) {
        try {
          const { _id, __v, ...rest } = e as BackupEasy & { _id?: string; __v?: number };
          void _id; void __v;
          await Easypaisa.create(rest);
          restored.easypaisa++;
        } catch {
          skipped.easypaisa++;
        }
      } else {
        skipped.easypaisa++;
      }
    }

    // 4. CUSTOMERS - Asad Khata fix - FIXED id:any
    for (const c of customers) {
      const norm = (c.normalizedName || c.name || "").trim().toLowerCase();
      const userIdStr = getUserIdString(c);
      if (!norm || !userIdStr) { skipped.customers++; continue; }

      const srcHistory = c.wusoolHistory ?? [];
      const totalWusool = srcHistory.reduce((sum: number, h: { amount: number; date?: string }) => sum + (Number(h.amount) || 0), 0);
      const totalBusiness = Number(c.totalBusiness) || Number(c.totalUdhar) || 0;
      const remaining = Math.max(0, totalBusiness - totalWusool);

      const existing = await Customer.findOne({ userId: userIdStr, normalizedName: norm, isPaid: false });

      if (existing) {
        existing.totalBusiness = totalBusiness;
        existing.totalUdhar = remaining;
        existing.paidAmount = totalWusool;
        existing.wusoolHistory = srcHistory as unknown as typeof existing.wusoolHistory;

        if (c.saleIds?.length) {
          const existingIds = (existing.saleIds || []).map((id: Types.ObjectId | string) => id.toString());
          const newIds = c.saleIds.map((id: string | Types.ObjectId) => id.toString());
          const merged = new Set<string>([...existingIds, ...newIds]);
          existing.saleIds = Array.from(merged).map((id: string) => new Types.ObjectId(id)) as unknown as typeof existing.saleIds;
        }
        existing.billsCount = existing.saleIds?.length || c.billsCount || 0;
        await existing.save();
        restored.customers++;
      } else {
        try {
          let byId = null;
          try {
            if (c._id && Types.ObjectId.isValid(c._id)) {
              byId = await Customer.findById(c._id).lean();
            }
          } catch { /* ignore */ }

          if (!byId) {
            const { _id, ...rest } = c as BackupCustomer & { _id?: string };
            void _id;
            await Customer.create({
              ...rest,
              normalizedName: norm,
              totalBusiness,
              totalUdhar: remaining,
              paidAmount: totalWusool,
              wusoolHistory: srcHistory,
              isPaid: remaining <= 0.01,
            });
            restored.customers++;
          } else {
            skipped.customers++;
          }
        } catch {
          skipped.customers++;
        }
      }
    }

    return NextResponse.json({ success: true, restored, skipped, message: "Asad backup restored" });
  } catch (e) {
    console.error("Restore error:", e);
    const msg = e instanceof Error ? e.message : "Restore failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}