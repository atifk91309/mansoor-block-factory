import Dexie, { type Table } from "dexie";

export type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "brick" | "other";
export type PaymentType = "cash" | "udhar" | "jazzcash" | "easypaisa" | "bank";
export type SyncStatus = 0 | 1;
export type StockMode = "limited" | "unlimited";
export type TrolleyStatus = "OPEN" | "CLOSED" | "SOLD";
export type TrolleyPurpose = "factory" | "direct_sale";
export type SaleSource = "trolley" | "block_product";
export type StockUnit = "trolley" | "tumper" | "bori" | "block" | "piece" | "cft" | "other";

export type WusoolHistoryEntry = { amount: number; date: string; note?: string };
export type WusoolSyncPayload = { amount: number; note?: string; date: string; customerLocalId?: string };
export type StockHistoryEntry = { qty: number; date: string; buyPrice: number; sellPrice: number };

export type BillEntry = { label: string; amount: number };
export type MixMaterialEntry = { 
  label: string; 
  qty: string;
  rairi: number; // Group 2 - rairi touch
  rate: number; // frozen per rairi
  amount: number;
  quantity: number; // for Group1 merge compat
  unit: StockUnit;
  trolleyEntryId?: string;
  batchId?: string;
};

export interface OfflineTrolleyEntry {
  localId: string;
  _id?: string;
  date: string;
  material: string;
  normalizedMaterial: string;
  quantity: number; // trolley count
  rairiPerTrolley: number; // 60 Maneray, 55 Ghata Shaga
  totalRairi: number;
  unit: StockUnit;
  trolleyPrice: number;
  perRairiRate: number;
  status: TrolleyStatus;
  purpose: TrolleyPurpose;
  batchId?: string;
  userId: string;
  synced: number;
  createdAt: string;
}

export interface OfflineTrolleyStock {
  localId: string;
  _id?: string;
  material: string;
  normalizedMaterial: string;
  totalQty: number; // trolley count
  rairiPerTrolley: number;
  totalRairi: number;
  usedRairi: number;
  remainingRairi: number;
  totalCost: number;
  avgRate: number;
  perRairiRate: number;
  unit: StockUnit;
  batchId?: string;
  userId: string;
  synced: number;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineBlockProduct {
  localId: string;
  _id?: string;
  name: string;
  category: BlockCategory;
  stock: number;
  stockMode: StockMode;
  unit: StockUnit;
  buyPriceAvg: number;
  buyPrice: number;
  sellPrice: number;
  lastPurchaseDate?: string;
  userId: string;
  synced: number;
  createdAt: string;
  stockHistory?: StockHistoryEntry[];
  batchId?: string;
  normalizedName?: string;
}

export interface OfflineSaleItem {
  productId?: string;
  productName: string;
  category: BlockCategory;
  source: SaleSource;
  quantity: number;
  unit: StockUnit;
  sellPrice: number;
  buyPrice: number;
  totalSell: number;
  totalProfit: number;
  batchId?: string;
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
  unit?: StockUnit;
  sellPrice: number;
  buyPrice: number;
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
  totalRairiUsed: number;
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

function getRairiForMaterial(name: string): number {
  const low = name.toLowerCase();
  if (low.includes("ghata") || low.includes("shaga") || low.includes("گھٹہ") || low.includes("شگہ")) return 55;
  return 60;
}

type LegacyStock = OfflineTrolleyStock & { totalRairi?: number; rairiPerUnit?: number; totalQty?: number };
type LegacyProduct = OfflineBlockProduct & { rairiPerTrolley?: number; buyPricePerRairi?: number; totalRairi?: number };

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

  constructor() {
    super("MansoorBlockFactoryOfflineV1");

    this.version(1).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, productId, userId, synced, createdAt, date",
      customers: "localId, _id, name, normalizedName, userId, synced",
      blockDaily: "localId, _id, userId, synced, date, createdAt",
      syncQueue: "++id, type, localId, createdAt",
    });

    this.version(22).stores({
      blockProducts: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, userId, synced, createdAt, date, customerName, paymentType, invoiceNo",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      blockDaily: "localId, _id, userId, synced, date, createdAt, blockType, blocksCount",
      syncQueue: "++id, type, localId, createdAt",
      monthlyExpenses: "month, _id, userId, synced, createdAt",
      trolleyEntries: "localId, _id, userId, synced, normalizedMaterial, status, createdAt, date",
      trolleyStock: "localId, _id, userId, synced, normalizedMaterial, createdAt",
    }).upgrade(async (tx) => {
      const tStock = tx.table("trolleyStock");
      await tStock.toCollection().modify((raw: unknown) => {
        const s = raw as LegacyStock;
        if (!s.rairiPerTrolley) s.rairiPerTrolley = getRairiForMaterial(s.material || "");
        const qty = s.totalQty || 0;
        if (!s.totalRairi || s.totalRairi === 0) {
          s.totalRairi = Math.round(qty * s.rairiPerTrolley);
        }
        s.usedRairi = s.usedRairi || 0;
        s.remainingRairi = Math.max(0, (s.totalRairi || 0) - (s.usedRairi || 0));
        if (s.avgRate && !s.perRairiRate) {
          s.perRairiRate = Number((s.avgRate / s.rairiPerTrolley).toFixed(2));
        }
        s.unit = s.unit || "trolley";
      });

      const products = tx.table("blockProducts");
      await products.toCollection().modify((raw: unknown) => {
        const p = raw as LegacyProduct;
        const delKeys = ["rairiPerTrolley", "buyPricePerRairi", "totalRairi"] as const;
        for (const k of delKeys) {
          delete (p as unknown as Record<string, unknown>)[k];
        }
        if (p.unit === "other" as unknown as StockUnit) {
          p.unit = "trolley";
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
      exist.quantity = rnd(exist.quantity + m.quantity);
      exist.amount = rnd(exist.amount + m.amount);
      exist.qty = `${exist.rairi} rairi`;
    } else {
      map.set(norm, { ...m });
    }
  }
  return Array.from(map.values());
}

export async function deductTrolleyOffline(_mixes: MixMaterialEntry[]): Promise<void> {
  console.log("Deduct disabled - trolley, blockDaily, products are separate modules now");
}

export async function revertTrolleyOffline(_mixes: MixMaterialEntry[]): Promise<void> {
  console.log("Revert disabled - modules are separate now");
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