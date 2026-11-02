import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import BlockProduct from "@/models/BlockProduct";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import BlockDaily from "@/models/BlockDaily";
import { Types } from "mongoose";

type BackupBase = {
  _id?: string;
  localId?: string;
  userId?: string | Types.ObjectId;
  name?: string;
};

type BackupBlockProduct = BackupBase & {
  stock?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  sellPrice?: number;
  category?: string;
  stockMode?: string;
  normalizedName?: string;
  stockHistory?: { qty: number; date: string; buyPrice: number; sellPrice: number }[];
};

type BackupSale = BackupBase & {
  invoiceNo?: string;
  date?: string;
  totalSell?: number;
  totalBuy?: number;
  totalProfit?: number;
  totalQuantity?: number;
  paymentType?: string;
  customerName?: string;
};

type BackupBlockDaily = BackupBase & {
  date?: string;
  cementBags?: number;
  blocksMade?: string;
  blocksCount?: number;
  dailyWages?: number;
};

type BackupWusool = { amount: number; date?: string; note?: string };

type BackupCustomer = BackupBase & {
  normalizedName?: string;
  totalBusiness?: number;
  totalUdhar?: number;
  paidAmount?: number;
  saleIds?: (string | Types.ObjectId)[];
  billsCount?: number;
  wusoolHistory?: BackupWusool[];
  isPaid?: boolean;
  village?: string;
};

type RestorePayload = {
  data?: {
    blockProducts?: BackupBlockProduct[];
    products?: BackupBlockProduct[];
    sales?: BackupSale[];
    customers?: BackupCustomer[];
    blockDaily?: BackupBlockDaily[];
    daily?: BackupBlockDaily[];
  };
  blockProducts?: BackupBlockProduct[];
  products?: BackupBlockProduct[];
  sales?: BackupSale[];
  customers?: BackupCustomer[];
  blockDaily?: BackupBlockDaily[];
  daily?: BackupBlockDaily[];
};

type RestoredCount = { blockProducts: number; sales: number; customers: number; blockDaily: number };

function getUserIdString(item: BackupBase): string | undefined {
  if (!item.userId) return undefined;
  return item.userId.toString();
}

function omitMongoFields<T extends Record<string, unknown>>(obj: T): Omit<T, "_id" | "__v"> {
  const { _id: _omitId, __v: _omitV, ...rest } = obj as T & { _id?: unknown; __v?: unknown };
  void _omitId;
  void _omitV;
  return rest;
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = (await req.json()) as RestorePayload;
    const src = body.data ? body.data : body;

    const blockProducts = src.blockProducts ?? src.products ?? [];
    const sales = src.sales ?? [];
    const customers = src.customers ?? [];
    const blockDaily = src.blockDaily ?? src.daily ?? [];

    const restored: RestoredCount = { blockProducts: 0, sales: 0, customers: 0, blockDaily: 0 };
    const skipped: RestoredCount = { blockProducts: 0, sales: 0, customers: 0, blockDaily: 0 };

    // 1. BLOCK PRODUCTS - 6 categories
    for (const p of blockProducts) {
      const userIdStr = getUserIdString(p);
      const nameVal = p.name;
      let exists: Record<string, unknown> | null = null;

      try {
        if (p._id && Types.ObjectId.isValid(p._id)) {
          exists = (await BlockProduct.findById(p._id).lean()) as Record<string, unknown> | null;
        }
      } catch {
        exists = null;
      }

      if (!exists && p.localId && userIdStr) {
        exists = (await BlockProduct.findOne({ localId: p.localId, userId: userIdStr }).lean()) as Record<string, unknown> | null;
      }
      if (!exists && nameVal && userIdStr) {
        const normalized = (p.normalizedName || nameVal).trim().toLowerCase();
        exists = (await BlockProduct.findOne({ userId: userIdStr, normalizedName: normalized, category: p.category }).lean()) as Record<string, unknown> | null;
      }

      if (!exists) {
        try {
          const rest = omitMongoFields(p as unknown as Record<string, unknown>);
          await BlockProduct.create(rest);
          restored.blockProducts++;
        } catch {
          skipped.blockProducts++;
        }
      } else {
        skipped.blockProducts++;
      }
    }

    // 2. SALES
    for (const s of sales) {
      let exists: Record<string, unknown> | null = null;
      try {
        if (s._id && Types.ObjectId.isValid(s._id)) {
          exists = (await Sale.findById(s._id).lean()) as Record<string, unknown> | null;
        }
      } catch {
        exists = null;
      }
      if (!exists && s.localId) {
        const uid = getUserIdString(s);
        if (uid) exists = (await Sale.findOne({ localId: s.localId, userId: uid }).lean()) as Record<string, unknown> | null;
      }
      if (!exists && s.invoiceNo) {
        const uid = getUserIdString(s);
        if (uid) exists = (await Sale.findOne({ invoiceNo: s.invoiceNo, userId: uid }).lean()) as Record<string, unknown> | null;
      }

      if (!exists) {
        try {
          const rest = omitMongoFields(s as unknown as Record<string, unknown>);
          await Sale.create(rest);
          restored.sales++;
        } catch {
          skipped.sales++;
        }
      } else {
        skipped.sales++;
      }
    }

    // 3. CUSTOMERS - Khata + wusoolHistory - FIXED TS7006 HERE
    for (const c of customers) {
      const norm = (c.normalizedName || c.name || "").trim().toLowerCase();
      const userIdStr = getUserIdString(c);
      if (!norm || !userIdStr) {
        skipped.customers++;
        continue;
      }

      const srcHistory = c.wusoolHistory ?? [];
      const totalWusool = srcHistory.reduce((sum: number, h: BackupWusool) => sum + (Number(h.amount) || 0), 0);
      const totalBusiness = Number(c.totalBusiness) || Number(c.totalUdhar) || 0;
      const remaining = Math.max(0, totalBusiness - totalWusool);

      const existing = await Customer.findOne({ userId: userIdStr, normalizedName: norm, isPaid: false });

      if (existing) {
        existing.totalBusiness = totalBusiness;
        existing.totalUdhar = remaining;
        existing.paidAmount = totalWusool;
        existing.wusoolHistory = srcHistory as unknown as typeof existing.wusoolHistory;
        if (c.saleIds?.length) {
          // ✅ FIXED: no implicit any
          const existingIds = (existing.saleIds || []).map((id: Types.ObjectId) => id.toString());
          const newIds = c.saleIds.map((id: string | Types.ObjectId) => id.toString());
          const merged = new Set<string>([...existingIds, ...newIds]);
          existing.saleIds = Array.from(merged).map((idString: string) => new Types.ObjectId(idString)) as unknown as typeof existing.saleIds;
        }
        existing.billsCount = existing.saleIds?.length || c.billsCount || 0;
        await existing.save();
        restored.customers++;
      } else {
        try {
          let byId: Record<string, unknown> | null = null;
          try {
            if (c._id && Types.ObjectId.isValid(c._id)) {
              byId = (await Customer.findById(c._id).lean()) as Record<string, unknown> | null;
            }
          } catch {
            byId = null;
          }
          if (!byId) {
            const rest = omitMongoFields(c as unknown as Record<string, unknown>);
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

    // 4. BLOCK DAILY - 4998 Blocks / 48 Bori
    for (const d of blockDaily) {
      let exists: Record<string, unknown> | null = null;
      try {
        if (d._id && Types.ObjectId.isValid(d._id)) {
          exists = (await BlockDaily.findById(d._id).lean()) as Record<string, unknown> | null;
        }
      } catch {
        exists = null;
      }
      if (!exists && d.localId) {
        const uid = getUserIdString(d);
        if (uid) exists = (await BlockDaily.findOne({ localId: d.localId, userId: uid }).lean()) as Record<string, unknown> | null;
      }

      if (!exists) {
        try {
          const rest = omitMongoFields(d as unknown as Record<string, unknown>);
          await BlockDaily.create(rest);
          restored.blockDaily++;
        } catch {
          skipped.blockDaily++;
        }
      } else {
        skipped.blockDaily++;
      }
    }

    return NextResponse.json({
      success: true,
      restored,
      skipped,
      message: `MOHAL restored - ${restored.blockProducts} products, ${restored.blockDaily} daily, ${restored.customers} khata`,
    });
  } catch (e) {
    console.error("Restore error:", e);
    const msg = e instanceof Error ? e.message : "Restore failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}