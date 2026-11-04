import Dexie, { type Table } from "dexie";

export type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "brick" | "other";
export type PaymentType = "cash" | "udhar" | "jazzcash" | "easypaisa" | "bank";
export type SyncStatus = 0 | 1;
export type StockMode = "limited" | "unlimited";
export type TrolleyStatus = "OPEN" | "CLOSED" | "SOLD";
export type TrolleyPurpose = "factory" | "direct_sale";
export type SaleSource = "trolley" | "block_product";

export type WusoolHistoryEntry = { amount: number; date: string; note?: string };
export type WusoolSyncPayload = { amount: number; note?: string; date: string; customerLocalId?: string };
export type StockHistoryEntry = { qty: number; date: string; buyPrice: number; sellPrice: number; rairi?: number; trolleyPrice?: number };

export type BillEntry = { label: string; amount: number };
export type MixMaterialEntry = { 
  label: string; 
  qty: string;
  rairi: number;
  rate: number;
  amount: number;
  trolleyEntryId?: string;
  batchId?: string;
};

// --- TROLLEY ---
export interface OfflineTrolleyEntry {
  localId: string;
  _id?: string;
  date: string;
  material: string;
  normalizedMaterial: string;
  rairiInTrolley: number;
  actualRairi?: number;
  rairiRemaining: number;
  rairiLoss: number;
  trolleyPrice: number;
  perRairiRate: number;
  status: TrolleyStatus;
  purpose: TrolleyPurpose;
  totalUsed: number;
  batchId?: string;
  closedAt?: string;
  userId: string;
  synced: number;
  createdAt: string;
}

export interface OfflineTrolleyStock {
  localId: string;
  _id?: string;
  material: string;
  normalizedMaterial: string;
  totalRairi: number;
  totalCost: number;
  avgRate: number;
  batchId?: string;
  userId: string;
  synced: number;
  createdAt: string;
  updatedAt: string;
}

// --- PRODUCTS --- FIX: rairiPerTrolley 60 / 800
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
  batchId?: string;
  rairiPerTrolley?: number;
  normalizedName?: string;
  buyPricePerRairi?: number;
}
export type OfflineProduct = OfflineBlockProduct & { rairiPerTrolley?: number };

export interface OfflineSaleItem {
  productId?: string;
  trolleyEntryId?: string;
  productName: string;
  category: BlockCategory;
  source: SaleSource;
  quantity: number;
  rairiQty: number;
  unit: string;
  sellPrice: number;
  buyPrice: number;
  buyPriceAvg: number;
  totalSell: number;
  totalProfit: number;
  batchId?: string;
  buyPricePerRairi?: number;
  rairiPerTrolley?: number;
}

export interface OfflineBlockDaily {
  localId: string;
  _id?: string;
  date: string;
  cementBags: number;
  cementRate: number;
  cementCost: number;
  blocksMade: string;
  blocksCount: number;
  dailyWages: number;
  mazdoorRatePerBlock: number;
  ratePerBlock: number;
  labourCost: number;
  blockType: string;
  userId: string;
  synced: number;
  createdAt: string;
  bills: BillEntry[];
  mixMaterials: MixMaterialEntry[];
  trolleyMixCost: number;
  mixCost: number;
  totalBill: number;
  costPerBlock: number;
  isMonthlyElectricity: boolean;
  batchId?: string;
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
  totalRairi: number;
  totalSell: number;
  totalBuy: number;
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
  batchId?: string;
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
  batchId?: string;
  electricity: number;
  rent: number;
  other: number;
  totalMonthly: number;
  totalBlocks: number;
  totalDailyBill: number;
  totalMixCost: number;
  totalCementCost: number;
  totalCementBags: number;
  totalTrolleyCost: number;
  totalLabourCost: number;
  costPerBlock: number;
  grandCostPerBlock: number;
  trueCostPerBlock: number;
  synced: number;
  createdAt: string;
  userId?: string;
}

export type OfflinePayload = OfflineBlockProduct | OfflineSale | OfflineCustomer | WusoolSyncPayload | OfflineBlockDaily | MonthlyExpenseLocal | OfflineTrolleyEntry | OfflineTrolleyStock;

export interface SyncQueueItem {
  id?: number;
  type: "sale" | "product" | "customer" | "wusool" | "blockDaily" | "monthlyExpense" | "trolleyEntry" | "trolleyClose" | "trolleySale";
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
  trolleyEntries!: Table<OfflineTrolleyEntry, string>;
  trolleyStock!: Table<OfflineTrolleyStock, string>;

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

    this.version(15).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, lastPurchaseDate",
      sales: "localId, _id, productId, userId, synced, createdAt, date, customerName, status, category, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksMade, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      monthlyExpenses: "month, _id, userId, synced, createdAt",
      trolleyEntries: "localId, _id, userId, synced, normalizedMaterial, status, createdAt, date, totalUsed",
      trolleyStock: "localId, _id, userId, synced, normalizedMaterial, createdAt, updatedAt",
      blockTypes: null,
      categories: null,
    });

    this.version(16).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt, batchId",
      sales: "localId, _id, userId, synced, createdAt, date, customerName, paymentType, invoiceNo, batchId",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, batchId, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      monthlyExpenses: "month, _id, userId, synced, createdAt, batchId",
      trolleyEntries: "localId, _id, userId, synced, normalizedMaterial, status, createdAt, batchId, purpose",
      trolleyStock: "localId, _id, userId, synced, normalizedMaterial, batchId, createdAt",
      blockTypes: null,
      categories: null,
    });

    this.version(19).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, userId, synced, createdAt, date, customerName, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      monthlyExpenses: "month, _id, userId, synced, createdAt",
      trolleyEntries: "localId, _id, userId, synced, normalizedMaterial, status, createdAt, date",
      trolleyStock: "localId, _id, userId, synced, normalizedMaterial, createdAt",
      blockTypes: null,
      categories: null,
    }).upgrade(async (tx) => {
      const productsTable = tx.table("blockProducts");
      await productsTable.toCollection().modify((p: Record<string, unknown>) => {
        if (p["rairiPerTrolley"] === undefined) p["rairiPerTrolley"] = 60;
      });
    });

    // VERSION 20 - FIX: Rate 2 decimal + API path consistent
    this.version(20).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, userId, synced, createdAt, date, customerName, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      monthlyExpenses: "month, _id, userId, synced, createdAt",
      trolleyEntries: "localId, _id, userId, synced, normalizedMaterial, status, createdAt, date",
      trolleyStock: "localId, _id, userId, synced, normalizedMaterial, createdAt",
      blockTypes: null,
      categories: null,
    }).upgrade(async (tx) => {
      // Fix old long decimal rates
      const tEntries = tx.table("trolleyEntries");
      await tEntries.toCollection().modify((e: Record<string, unknown>) => {
        if (e["perRairiRate"] !== undefined) {
          e["perRairiRate"] = Number(Number(e["perRairiRate"]).toFixed(2));
        }
        if (e["rairiPerTrolley"] === undefined) e["rairiPerTrolley"] = 60;
      });
      const tStock = tx.table("trolleyStock");
      await tStock.toCollection().modify((s: Record<string, unknown>) => {
        if (s["avgRate"] !== undefined) {
          s["avgRate"] = Number(Number(s["avgRate"]).toFixed(2));
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

export function mergeMixMaterialsOffline(mixes: MixMaterialEntry[]): MixMaterialEntry[] {
  const map = new Map<string, MixMaterialEntry>();
  for (const m of mixes) {
    const norm = m.label.toLowerCase().trim();
    const exist = map.get(norm);
    if (exist) {
      exist.rairi = rnd(exist.rairi + m.rairi);
      exist.amount = rnd(exist.amount + m.amount);
      exist.qty = `${exist.rairi} ریڑھی`;
    } else {
      map.set(norm, { ...m, qty: m.qty || `${m.rairi} ریڑھی` });
    }
  }
  return Array.from(map.values());
}

export async function deductTrolleyOffline(mixes: MixMaterialEntry[]): Promise<void> {
  for (const m of mixes) {
    const rairi = rnd(m.rairi);
    if (rairi <= 0) continue;
    let entry: OfflineTrolleyEntry | undefined;
    if (m.trolleyEntryId) {
      entry = await offlineDB.trolleyEntries.where("localId").equals(m.trolleyEntryId).first();
    }
    if (!entry) {
      const all = await offlineDB.trolleyEntries.where("normalizedMaterial").equals(m.label.toLowerCase().trim()).toArray();
      entry = all.filter(e => e.status === "OPEN").sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
    }
    if (entry) {
      const newUsed = rnd(entry.totalUsed + rairi);
      const remaining = Math.max(0, (entry.actualRairi || entry.rairiInTrolley) - newUsed);
      await offlineDB.trolleyEntries.update(entry.localId, { totalUsed: newUsed, rairiRemaining: remaining, synced: 0 });
      const stock = await offlineDB.trolleyStock.where("normalizedMaterial").equals(entry.normalizedMaterial).first();
      if (stock) {
        const newRairi = Math.max(0, rnd(stock.totalRairi - rairi));
        await offlineDB.trolleyStock.update(stock.localId, { totalRairi: newRairi, updatedAt: new Date().toISOString(), synced: 0 });
      }
    }
  }
}

export async function revertTrolleyOffline(mixes: MixMaterialEntry[]): Promise<void> {
  for (const m of mixes) {
    const rairi = rnd(m.rairi);
    if (rairi <= 0) continue;
    let entry: OfflineTrolleyEntry | undefined;
    if (m.trolleyEntryId) {
      entry = await offlineDB.trolleyEntries.where("localId").equals(m.trolleyEntryId).first();
    }
    if (!entry) {
      const all = await offlineDB.trolleyEntries.where("normalizedMaterial").equals(m.label.toLowerCase().trim()).toArray();
      entry = all.filter(e => (e.totalUsed || 0) >= 1).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    }
    if (entry) {
      const newUsed = Math.max(0, rnd(entry.totalUsed - rairi));
      const remaining = Math.max(0, (entry.actualRairi || entry.rairiInTrolley) - newUsed);
      await offlineDB.trolleyEntries.update(entry.localId, { totalUsed: newUsed, rairiRemaining: remaining, synced: 0 });
      const stock = await offlineDB.trolleyStock.where("normalizedMaterial").equals(entry.normalizedMaterial).first();
      if (stock) {
        const newRairi = rnd(stock.totalRairi + rairi);
        await offlineDB.trolleyStock.update(stock.localId, { totalRairi: newRairi, updatedAt: new Date().toISOString(), synced: 0 });
      }
    }
  }
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