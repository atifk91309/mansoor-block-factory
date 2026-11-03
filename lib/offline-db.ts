import Dexie, { type Table } from "dexie";

export type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "other";
export type PaymentType = "cash" | "udhar" | "jazzcash" | "easypaisa" | "bank";
export type SyncStatus = 0 | 1;
export type StockMode = "limited" | "unlimited";

export type WusoolHistoryEntry = { amount: number; date: string; note?: string };
export type WusoolSyncPayload = { amount: number; note?: string; date: string; customerLocalId?: string };
export type StockHistoryEntry = { qty: number; date: string; buyPrice: number; sellPrice: number };

export type BillEntry = { label: string; amount: number };
export type MixMaterialEntry = { label: string; qty: string };

export interface OfflineBlockProduct {
  localId: string;
  _id?: string;
  name: string;
  category: BlockCategory;
  stock: number;
  stockMode: StockMode;
  buyPriceAvg: number;
  buyPrice: number;
  sellPrice: number;
  lastPurchaseDate?: string;
  company?: string;
  userId: string;
  synced: number;
  createdAt: string;
  lastSyncedAt?: string;
  stockHistory?: StockHistoryEntry[];
}
export type OfflineProduct = OfflineBlockProduct;

export interface OfflineSaleItem {
  productId: string;
  productName: string;
  category: BlockCategory;
  quantity: number;
  sellPrice: number;
  buyPrice: number;
  buyPriceAvg: number;
  totalSell: number;
  totalProfit: number;
}

export interface OfflineBlockDaily {
  localId: string;
  _id?: string;
  date: string;
  cementBags: number;
  blocksMade: string;
  blocksCount: number;
  dailyWages: number;
  ratePerBlock: number;
  blockType: string;
  userId: string;
  synced: number;
  createdAt: string;
  bills: BillEntry[];
  mixMaterials: MixMaterialEntry[];
  totalBill: number;
  costPerBlock: number;
  isMonthlyElectricity: boolean;
}

export interface OfflineSale {
  localId: string;
  _id?: string;
  invoiceNo: string;
  date: string;
  customerName: string;
  customerId?: string;
  paymentType: PaymentType;
  isUdhar: boolean;
  status: "paid" | "pending";
  totalQuantity: number;
  totalSell: number;
  totalProfit: number;
  userId: string;
  createdAt: string;
  synced: number;
  items: OfflineSaleItem[];
  productId: string;
  productName: string;
  category: BlockCategory;
  quantity: number;
  unit?: string;
  sellPrice: number;
  buyPrice: number;
  buyPriceAvg: number;
  total: number;
  profit: number;
}

export interface OfflineCustomer {
  localId: string;
  _id?: string;
  saleIds: string[];
  name: string;
  normalizedName: string;
  phone?: string;
  village?: string;
  totalUdhar: number;
  totalBusiness: number;
  lastUdharDate?: string;
  lastWusoolDate?: string;
  paidAt?: string;
  synced: number;
  createdAt?: string;
  billsCount: number;
  isPaid?: boolean;
  paidAmount?: number;
  wusoolHistory?: WusoolHistoryEntry[];
  userId?: string;
}

export interface MonthlyExpenseLocal {
  month: string;
  _id?: string;
  electricity: number;
  rent: number;
  other: number;
  totalMonthly: number;
  totalBlocks: number;
  totalDailyBill: number;
  costPerBlock: number;
  grandCostPerBlock: number;
  synced: number;
  createdAt: string;
  userId?: string;
}

export type OfflinePayload = OfflineBlockProduct | OfflineSale | OfflineCustomer | WusoolSyncPayload | OfflineBlockDaily | MonthlyExpenseLocal;

export interface SyncQueueItem {
  id?: number;
  type: "sale" | "product" | "customer" | "wusool" | "blockDaily" | "monthlyExpense";
  localId: string;
  payload: OfflinePayload;
  createdAt: Date;
  attempts: number;
}

function rnd(n: number): number { return Math.round(n || 0); }

export class OfflineDB extends Dexie {
  blockProducts!: Table<OfflineBlockProduct, string>;
  sales!: Table<OfflineSale, string>;
  customers!: Table<OfflineCustomer, string>;
  blockDaily!: Table<OfflineBlockDaily, string>;
  monthlyExpenses!: Table<MonthlyExpenseLocal, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  get products(): Table<OfflineBlockProduct, string> { return this.blockProducts; }
  get allTableNames(): string[] { return this.tables.map(t => t.name); }

  constructor() {
    super("MansoorBlockFactoryOfflineV1");

    this.version(1).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType",
      syncQueue: "++id, type, localId, createdAt",
    });

    this.version(2).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType",
      syncQueue: "++id, type, localId, createdAt",
    });

    this.version(3).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType",
      syncQueue: "++id, type, localId, createdAt",
    });

    this.version(4).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType",
      syncQueue: "++id, type, localId, createdAt",
    }).upgrade(async (tx) => {
      const salesTable = tx.table("sales");
      await salesTable.toCollection().modify((sale: Record<string, unknown>) => {
        if (!sale["items"]) {
          const prodId = (sale["productId"] as string) || "";
          const prodName = (sale["productName"] as string) || "Block";
          const cat = (sale["category"] as BlockCategory) || "block";
          const qty = rnd(Number(sale["quantity"]) || 0);
          const sell = rnd(Number(sale["sellPrice"]) || 0);
          const buy = rnd(Number(sale["buyPriceAvg"] || sale["buyPrice"]) || 0);
          const totalSell = rnd(Number(sale["total"]) || sell * qty);
          const totalProfit = rnd(Number(sale["profit"]) || (sell - buy) * qty);
          sale["items"] = [{ productId: prodId, productName: prodName, category: cat, quantity: qty, sellPrice: sell, buyPrice: buy, buyPriceAvg: buy, totalSell, totalProfit }];
          sale["totalQuantity"] = qty;
          sale["totalSell"] = totalSell;
          sale["totalProfit"] = totalProfit;
          sale["isUdhar"] = sale["paymentType"] === "udhar" || sale["status"] === "pending";
          if (!sale["invoiceNo"]) sale["invoiceNo"] = `INV-${Date.now().toString().slice(-6)}`;
          if (!sale["date"]) sale["date"] = (sale["createdAt"] as string) || new Date().toISOString();
        }
      });
    });

    this.version(5).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType",
      syncQueue: "++id, type, localId, createdAt",
    }).upgrade(async (tx) => {
      const bpTable = tx.table("blockProducts");
      await bpTable.toCollection().modify((bp: Record<string, unknown>) => {
        if (!bp["stockHistory"]) {
          const stock = rnd(Number(bp["stock"]) || 0);
          const createdAt = (bp["createdAt"] as string) || new Date().toISOString();
          const buy = rnd(Number(bp["buyPriceAvg"] || bp["buyPrice"]) || 0);
          const sell = rnd(Number(bp["sellPrice"]) || 0);
          bp["stockHistory"] = stock > 0 ? [{ qty: stock, date: createdAt, buyPrice: buy, sellPrice: sell }] : [];
        }
      });
    });

    this.version(6).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType",
      syncQueue: "++id, type, localId, createdAt",
      trollyPurchases: null,
      blockTypes: null,
    });

    this.version(7).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksMade",
      syncQueue: "++id, type, localId, createdAt",
      blockTypes: null,
    }).upgrade(async (tx) => {
      const dailyTable = tx.table("blockDaily");
      await dailyTable.toCollection().modify((d: Record<string, unknown>) => {
        if (typeof d["blocksMade"] === "number") {
          const count = rnd(Number(d["blocksMade"]) || 0);
          d["blocksCount"] = count;
          d["blocksMade"] = (d["blockType"] as string) || "6 inch Block";
        }
        if (d["blocksCount"] === undefined) {
          d["blocksCount"] = rnd(Number(d["blocksMade"]) || 0) || 0;
          if (typeof d["blocksMade"] === "number") d["blocksMade"] = "6 inch Block";
        }
      });
    });

    this.version(8).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksMade, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      blockTypes: null,
      categories: null,
    });

    this.version(9).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksMade, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      blockTypes: null,
      categories: null,
    });

    this.version(10).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksMade, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      blockTypes: null,
      categories: null,
    }).upgrade(async (tx) => {
      const dailyTable = tx.table("blockDaily");
      await dailyTable.toCollection().modify((d: Record<string, unknown>) => {
        if (!d["bills"]) d["bills"] = [];
        if (!d["mixMaterials"]) d["mixMaterials"] = [];
        if (d["totalBill"] === undefined) d["totalBill"] = d["dailyWages"] || 0;
        if (d["costPerBlock"] === undefined) d["costPerBlock"] = 0;
        if (d["isMonthlyElectricity"] === undefined) d["isMonthlyElectricity"] = false;
      });
    });

    this.version(11).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksMade, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      monthlyExpenses: "month, _id, userId, synced, createdAt",
      blockTypes: null,
      categories: null,
    });

    // V12 FIX - force re-create monthlyExpenses index + clean pending sync
    this.version(12).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksMade, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      monthlyExpenses: "month, _id, userId, synced, createdAt",
      blockTypes: null,
      categories: null,
    }).upgrade(async (tx) => {
      const meTable = tx.table("monthlyExpenses");
      await meTable.toCollection().modify((m: Record<string, unknown>) => {
        if (m["synced"] === undefined) m["synced"] = 0;
        if (m["totalMonthly"] === undefined) {
          m["totalMonthly"] = rnd(Number(m["electricity"]) || 0) + rnd(Number(m["rent"]) || 0) + rnd(Number(m["other"]) || 0);
        }
      });
    });
  }
}

export const offlineDB = new OfflineDB();
export const db = offlineDB;

export function calcProfit(sellPrice: number, buyPriceAvg: number, qty: number): number {
  return rnd((rnd(sellPrice) - rnd(buyPriceAvg)) * rnd(qty));
}
export function calcTotal(sellPrice: number, qty: number): number {
  return rnd(rnd(sellPrice) * rnd(qty));
}

export async function upsertOfflineCustomer(sale: OfflineSale, village = "", phone = ""): Promise<string | null> {
  const name = (sale.customerName || "").trim();
  if (!name || name.toLowerCase() === "walk-in") return null;
  const normalized = name.toLowerCase();
  const saleTotal = rnd(sale.totalSell || sale.total || 0);
  const existing = await offlineDB.customers.where("normalizedName").equals(normalized).first();
  if (existing && !existing.isPaid) {
    await offlineDB.customers.update(existing.localId, {
      totalUdhar: rnd(existing.totalUdhar + saleTotal),
      totalBusiness: rnd(existing.totalBusiness + saleTotal),
      saleIds: [...(existing.saleIds || []), sale.localId],
      billsCount: (existing.billsCount || 1) + 1,
      lastUdharDate: new Date().toISOString(),
      synced: 0,
    });
    return existing.localId;
  } else {
    const localId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await offlineDB.customers.add({
      localId, saleIds: [sale.localId], name, normalizedName: normalized,
      phone, village, totalUdhar: saleTotal, totalBusiness: saleTotal,
      lastUdharDate: new Date().toISOString(), synced: 0,
      createdAt: new Date().toISOString(), billsCount: 1, isPaid: false, paidAmount: 0,
      wusoolHistory: [], userId: sale.userId,
    });
    return localId;
  }
}

export async function addOfflineWusool(customerLocalId: string, amount: number, note = ""): Promise<WusoolHistoryEntry | null> {
  const customer = await offlineDB.customers.get(customerLocalId);
  if (!customer) return null;
  const paid = rnd(amount);
  const newUdhar = rnd(customer.totalUdhar - paid);
  const entry: WusoolHistoryEntry = { amount: paid, date: new Date().toISOString(), note };
  if (newUdhar <= 0) {
    await offlineDB.customers.update(customerLocalId, {
      totalUdhar: 0, isPaid: true, paidAmount: customer.totalBusiness,
      lastWusoolDate: entry.date, wusoolHistory: [...(customer.wusoolHistory || []), entry], synced: 0,
    });
  } else {
    await offlineDB.customers.update(customerLocalId, {
      totalUdhar: newUdhar, paidAmount: rnd((customer.paidAmount || 0) + paid),
      lastWusoolDate: entry.date, wusoolHistory: [...(customer.wusoolHistory || []), entry], synced: 0,
    });
  }
  await offlineDB.syncQueue.add({
    type: "wusool", localId: customerLocalId,
    payload: { amount: paid, note, date: entry.date, customerLocalId },
    createdAt: new Date(), attempts: 0,
  });
  return entry;
}