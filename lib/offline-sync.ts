import { offlineDB, calcProfit, calcTotal } from "./offline-db";
import type { 
  OfflineSale, OfflineSaleItem, OfflineBlockProduct, OfflineBlockDaily, 
  BlockCategory, PaymentType, BillEntry, MixMaterialEntry,
  MonthlyExpenseLocal, OfflineCustomer, WusoolSyncPayload,
  OfflineTrolleyEntry, OfflineTrolleyStock, SaleSource, TrolleyPurpose,
  OfflinePayload, SyncQueueItem
} from "./offline-db";

const API_TROLLEY = "/api/trolley-stock";

export interface SaleInput {
  productId?: string;
  trolleyEntryId?: string;
  productName: string;
  category: BlockCategory;
  source?: SaleSource;
  quantity: number;
  rairiQty?: number;
  unit?: string;
  buyPrice: number;
  buyPriceAvg: number;
  sellPrice: number;
  batchId?: string;
  userId: string;
  customerName?: string;
  phone?: string;
  village?: string;
  paymentType?: PaymentType;
  date?: string;
  localId?: string;
  invoiceNo?: string;
  rairiPerTrolley?: number;
}

export interface BlockDailyInput {
  date: string;
  cementBags: number;
  cementRate?: number;
  cementCost?: number;
  blocksMade: string;
  blocksCount: number;
  mazdoorRatePerBlock?: number;
  ratePerBlock?: number;
  dailyWages?: number;
  labourCost?: number;
  blockType?: string;
  userId: string;
  batchId?: string;
  localId?: string;
  bills?: BillEntry[];
  mixMaterials?: MixMaterialEntry[];
  trolleyMixCost?: number;
  mixCost?: number;
  totalBill?: number;
  costPerBlock?: number;
  isMonthlyElectricity?: boolean;
}

export interface MonthlyExpenseInput {
  month: string; batchId?: string; electricity: number; rent: number; other: number;
  totalMonthly: number; totalBlocks: number; totalDailyBill: number; totalMixCost: number;
  totalCementCost?: number; totalCementBags?: number; totalTrolleyCost?: number; totalLabourCost?: number;
  costPerBlock: number; grandCostPerBlock: number; trueCostPerBlock?: number; userId: string; localId?: string;
}
export interface TrolleyInput {
  material: string; rairiInTrolley: number; trolleyPrice: number;
  purpose?: TrolleyPurpose; batchId?: string; date?: string; localId?: string; userId: string;
}
export interface TrolleyCloseInput { localId: string; actualRairi: number; userId: string; }
type TrolleyClosePayload = { localId: string; actualRairi: number; userId: string };

function genLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
function rnd(n: number): number { return Math.round(n || 0); }
function isElectricLabel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("electric") || l.includes("bijli") || l.includes("بجلی") || l.includes("wapda");
}
type SyncableRegistration = ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };

export async function saveSaleOffline(data: SaleInput): Promise<string> {
  const buy = rnd(data.buyPriceAvg || data.buyPrice || 0);
  const sell = rnd(data.sellPrice || 0);
  const qty = rnd(data.quantity || 1);
  const rairiQty = rnd(data.rairiQty || 0);
  const source = data.source || (data.trolleyEntryId ? "trolley" : "block_product");
  const batchId = data.batchId;
  const totalSell = calcTotal(sell, qty);
  const totalProfit = calcProfit(sell, buy, qty);
  const isUdhar = data.paymentType === "udhar";
  const status = isUdhar ? "pending" as const : "paid" as const;
  const nowISO = new Date().toISOString();
  const saleDate = data.date || nowISO;
  const localId = data.localId || genLocalId("sale");
  const invoiceNo = data.invoiceNo || `MOHAL-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const rairiStd = data.rairiPerTrolley || 60;
  const item: OfflineSaleItem = {
    productId: data.productId, trolleyEntryId: data.trolleyEntryId,
    productName: data.productName, category: data.category, source,
    quantity: qty, rairiQty: rairiQty || (source === "trolley" ? qty * rairiStd : 0),
    unit: data.unit || (source === "trolley" ? "trolly" : "piece"),
    sellPrice: sell, buyPrice: buy, buyPriceAvg: buy, totalSell, totalProfit, batchId,
    buyPricePerRairi: rairiStd > 0 ? Number((buy / rairiStd).toFixed(2)) : 0,
    rairiPerTrolley: rairiStd,
  };
  const sale: OfflineSale = {
    localId, invoiceNo, date: saleDate, customerName: data.customerName || "Walk-in",
    paymentType: (data.paymentType || "cash") as PaymentType, isUdhar, status,
    totalQuantity: qty, totalRairi: item.rairiQty, totalSell, totalBuy: rnd(buy * qty), totalProfit,
    userId: data.userId, createdAt: nowISO, synced: 0, items: [item],
    productId: data.productId || "", productName: data.productName, category: data.category,
    quantity: qty, unit: item.unit, sellPrice: sell, buyPrice: buy, buyPriceAvg: buy,
    total: totalSell, profit: totalProfit, batchId,
  };
  await offlineDB.transaction("rw", offlineDB.blockProducts, offlineDB.sales, offlineDB.customers, offlineDB.syncQueue, async () => {
    if (source === "block_product" && data.productId) {
      const byId = await offlineDB.blockProducts.get(data.productId);
      const byLocal = byId ? null : await offlineDB.blockProducts.where("localId").equals(data.productId).first();
      const product = byId || byLocal || await offlineDB.blockProducts.where("_id").equals(data.productId).first();
      if (product && product.stockMode === "limited") {
        if (product.stock < qty) throw new Error(`صرف ${product.stock} باقی ہے ${product.name} کے لیے`);
        await offlineDB.blockProducts.update(product.localId, { stock: rnd(product.stock - qty), synced: 0 });
      }
    }
    await offlineDB.sales.put(sale);
    await offlineDB.syncQueue.put({ type: source === "trolley" ? "trolleySale" : "sale", localId, payload: sale, createdAt: new Date(), attempts: 0 });
    if (isUdhar && data.customerName && data.customerName.toLowerCase() !== "walk-in") {
      const normalized = data.customerName.trim().toLowerCase();
      const existing = await offlineDB.customers.where("normalizedName").equals(normalized).first();
      if (existing && !existing.isPaid) {
        await offlineDB.customers.update(existing.localId, {
          totalUdhar: rnd(existing.totalUdhar + totalSell),
          totalBusiness: rnd(existing.totalBusiness + totalSell),
          saleIds: [...(existing.saleIds || []), localId],
          billsCount: rnd((existing.billsCount || 0) + 1),
          lastUdharDate: saleDate, synced: 0,
        });
        await offlineDB.sales.update(localId, { customerId: existing.localId });
      } else {
        const custLocalId = genLocalId("cust");
        await offlineDB.customers.add({
          localId: custLocalId, saleIds: [localId], name: data.customerName.trim(),
          normalizedName: normalized, phone: data.phone || "", village: data.village || "",
          totalUdhar: totalSell, totalBusiness: totalSell, lastUdharDate: saleDate, synced: 0,
          createdAt: nowISO, billsCount: 1, isPaid: false, paidAmount: 0, wusoolHistory: [], userId: data.userId,
        });
        await offlineDB.sales.update(localId, { customerId: custLocalId });
      }
    }
  });
  if (source === "trolley" && data.trolleyEntryId) {
    await offlineDB.transaction("rw", offlineDB.trolleyEntries, offlineDB.trolleyStock, async () => {
      const entry = await offlineDB.trolleyEntries.get(data.trolleyEntryId!) || await offlineDB.trolleyEntries.where("localId").equals(data.trolleyEntryId!).first();
      if (entry) {
        await offlineDB.trolleyEntries.update(entry.localId, { status: "SOLD", totalUsed: entry.rairiInTrolley, rairiRemaining: 0, synced: 0 });
        const stock = await offlineDB.trolleyStock.where("normalizedMaterial").equals(entry.normalizedMaterial).first();
        if (stock) {
          const eff = entry.actualRairi || entry.rairiInTrolley;
          await offlineDB.trolleyStock.update(stock.localId, { totalRairi: Math.max(0, rnd(stock.totalRairi - eff)), updatedAt: nowISO, synced: 0 });
        }
      }
    });
  }
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try { const reg = (await navigator.serviceWorker.ready) as SyncableRegistration; if (reg.sync) await reg.sync.register("sync-sales"); } catch {}
  }
  return localId;
}

export async function saveBlockDailyOffline(data: BlockDailyInput): Promise<string> {
  const localId = data.localId || genLocalId("daily");
  const mazdoorRate = rnd(data.mazdoorRatePerBlock || data.ratePerBlock || 3);
  const count = rnd(data.blocksCount);
  const cementBags = rnd(data.cementBags);
  const cementRate = rnd(data.cementRate || 1400);
  const cementCost = rnd(data.cementCost || cementBags * cementRate);
  const wages = rnd(data.dailyWages || data.labourCost || count * mazdoorRate);
  const batchId = data.batchId;
  const nowISO = new Date().toISOString();
  const cleanBills: BillEntry[] = (data.bills || []).filter(b => b.label && b.label.trim().length > 0).map(b => ({ label: b.label.trim(), amount: rnd(b.amount || 0) }));
  let cleanMix: MixMaterialEntry[] = (data.mixMaterials || []).filter(m => m.label && m.label.trim().length > 0 && (m.rairi || 0) > 0).map(m => {
    const rairi = rnd(m.rairi || 0); const ratePer = rnd(m.rate || 0);
    return { label: m.label.trim(), qty: m.qty?.trim() || `${rairi} ریڑھی`, rairi, rate: ratePer, amount: rnd(m.amount || rairi * ratePer), trolleyEntryId: m.trolleyEntryId?.trim() || "", batchId: m.batchId || batchId };
  });
  const mergedMap = new Map<string, MixMaterialEntry>();
  for (const m of cleanMix) {
    const norm = m.label.toLowerCase().trim(); const exist = mergedMap.get(norm);
    if (exist) { exist.rairi = rnd(exist.rairi + m.rairi); exist.amount = rnd(exist.amount + m.amount); exist.qty = `${exist.rairi} ریڑھی`; }
    else { mergedMap.set(norm, { ...m }); }
  }
  cleanMix = Array.from(mergedMap.values());
  const extraBills = cleanBills.reduce((sum, b) => {
    if (b.label.toLowerCase().includes("labour")) return sum;
    if (data.isMonthlyElectricity && isElectricLabel(b.label)) return sum;
    return sum + (b.amount || 0);
  }, 0);
  const trolleyMixCost = cleanMix.reduce((s, m) => s + (m.amount || 0), 0);
  const mixCost = trolleyMixCost + cementCost;
  const totalBill = data.totalBill !== undefined ? data.totalBill : wages + extraBills + mixCost;
  const daily: OfflineBlockDaily = {
    localId, date: data.date, cementBags, cementRate, cementCost,
    blocksMade: data.blocksMade.trim(), blocksCount: count, dailyWages: wages,
    mazdoorRatePerBlock: mazdoorRate, ratePerBlock: mazdoorRate, labourCost: wages,
    blockType: data.blockType || "6 inch", userId: data.userId, batchId, synced: 0, createdAt: nowISO,
    bills: cleanBills, mixMaterials: cleanMix, trolleyMixCost, mixCost, totalBill,
    costPerBlock: count > 0 ? Math.round((totalBill / count) * 100) / 100 : 0,
    isMonthlyElectricity: data.isMonthlyElectricity || false,
  };
  await offlineDB.transaction("rw", offlineDB.blockDaily, offlineDB.syncQueue, offlineDB.trolleyEntries, async () => {
    await offlineDB.blockDaily.put(daily);
    await offlineDB.syncQueue.put({ type: "blockDaily", localId, payload: daily, createdAt: new Date(), attempts: 0 });
    for (const m of cleanMix) {
      if (m.rairi <= 0) continue;
      let entry: OfflineTrolleyEntry | undefined;
      if (m.trolleyEntryId) entry = await offlineDB.trolleyEntries.get(m.trolleyEntryId) || await offlineDB.trolleyEntries.where("localId").equals(m.trolleyEntryId).first();
      if (!entry) {
        const all = await offlineDB.trolleyEntries.where("normalizedMaterial").equals(m.label.toLowerCase().trim()).toArray().catch((): OfflineTrolleyEntry[] => []);
        entry = all.filter(e => e.status === "OPEN").sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
      }
      if (entry) {
        const newUsed = rnd((entry.totalUsed || 0) + m.rairi);
        const remaining = Math.max(0, (entry.actualRairi || entry.rairiInTrolley) - newUsed);
        await offlineDB.trolleyEntries.update(entry.localId, { totalUsed: newUsed, rairiRemaining: remaining, synced: 0 });
      }
    }
  });
  await offlineDB.transaction("rw", offlineDB.trolleyStock, offlineDB.blockProducts, async () => {
    const allEntries = await offlineDB.trolleyEntries.toArray().catch((): OfflineTrolleyEntry[] => []);
    const stockMap = new Map<string, { rairi: number; cost: number }>();
    for (const e of allEntries) {
      const norm = e.normalizedMaterial; const eff = rnd(e.actualRairi ?? e.rairiInTrolley);
      const rem = Math.max(0, eff - rnd(e.totalUsed || 0)); if (rem <= 0) continue;
      const cur = stockMap.get(norm) ?? { rairi: 0, cost: 0 }; cur.rairi += rem; cur.cost += rem * Number(e.perRairiRate || 0); stockMap.set(norm, cur);
    }
    for (const [norm, v] of stockMap) {
      const stock = await offlineDB.trolleyStock.where("normalizedMaterial").equals(norm).first();
      if (stock) {
        const avg = v.rairi > 0 ? Number((v.cost / v.rairi).toFixed(2)) : 0;
        await offlineDB.trolleyStock.update(stock.localId, { totalRairi: rnd(v.rairi), totalCost: rnd(v.cost), avgRate: avg, updatedAt: nowISO, synced: 0 });
      }
    }
  });
  return localId;
}

export async function deleteBlockDailyOffline(localId: string): Promise<void> {
  const daily = await offlineDB.blockDaily.get(localId); if (!daily) return;
  const nowISO = new Date().toISOString();
  await offlineDB.transaction("rw", offlineDB.blockDaily, offlineDB.trolleyEntries, offlineDB.syncQueue, async () => {
    for (const m of daily.mixMaterials) {
      const rairi = rnd(m.rairi); if (rairi <= 0) continue;
      let entry = await offlineDB.trolleyEntries.where("localId").equals(m.trolleyEntryId || "").first().catch((): OfflineTrolleyEntry | undefined => undefined);
      if (!entry) {
        const all = await offlineDB.trolleyEntries.where("normalizedMaterial").equals(m.label.toLowerCase().trim()).toArray().catch((): OfflineTrolleyEntry[] => []);
        entry = all.filter(e => (e.totalUsed || 0) >= 1).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      }
      if (entry) {
        const newUsed = Math.max(0, rnd(entry.totalUsed - rairi));
        const remaining = Math.max(0, (entry.actualRairi || entry.rairiInTrolley) - newUsed);
        await offlineDB.trolleyEntries.update(entry.localId, { totalUsed: newUsed, rairiRemaining: remaining, synced: 0 });
      }
    }
    await offlineDB.blockDaily.delete(localId);
    await offlineDB.syncQueue.where("localId").equals(localId).delete();
  });
  await offlineDB.transaction("rw", offlineDB.trolleyStock, async () => {
    const allEntries = await offlineDB.trolleyEntries.toArray().catch((): OfflineTrolleyEntry[] => []);
    const stockMap = new Map<string, { rairi: number; cost: number }>();
    for (const e of allEntries) {
      const norm = e.normalizedMaterial; const eff = rnd(e.actualRairi ?? e.rairiInTrolley);
      const rem = Math.max(0, eff - rnd(e.totalUsed || 0));
      const cur = stockMap.get(norm) ?? { rairi: 0, cost: 0 }; cur.rairi += rem; cur.cost += rem * Number(e.perRairiRate || 0); stockMap.set(norm, cur);
    }
    for (const [norm, v] of stockMap) {
      const stock = await offlineDB.trolleyStock.where("normalizedMaterial").equals(norm).first();
      if (stock) {
        await offlineDB.trolleyStock.update(stock.localId, {
          totalRairi: rnd(v.rairi), totalCost: rnd(v.cost),
          avgRate: v.rairi > 0 ? Number((v.cost / v.rairi).toFixed(2)) : 0, updatedAt: nowISO, synced: 0,
        });
      }
    }
  });
}

export async function saveMonthlyExpenseOffline(data: MonthlyExpenseInput): Promise<string> {
  const nowISO = new Date().toISOString(); const batchId = data.batchId;
  const doc: MonthlyExpenseLocal = {
    month: data.month, _id: data.localId, batchId,
    electricity: rnd(data.electricity), rent: rnd(data.rent), other: rnd(data.other),
    totalMonthly: rnd(data.totalMonthly), totalBlocks: rnd(data.totalBlocks), totalDailyBill: rnd(data.totalDailyBill),
    totalMixCost: rnd(data.totalMixCost || 0), totalCementCost: rnd(data.totalCementCost || 0),
    totalCementBags: rnd(data.totalCementBags || 0), totalTrolleyCost: rnd(data.totalTrolleyCost || 0),
    totalLabourCost: rnd(data.totalLabourCost || 0), costPerBlock: data.costPerBlock,
    grandCostPerBlock: data.grandCostPerBlock, trueCostPerBlock: data.trueCostPerBlock || data.grandCostPerBlock,
    synced: 0, createdAt: nowISO, userId: data.userId,
  };
  await offlineDB.monthlyExpenses.put(doc);
  await offlineDB.syncQueue.put({ type: "monthlyExpense", localId: data.month, payload: doc, createdAt: new Date(), attempts: 0 });
  return data.month;
}

export async function saveTrolleyOffline(data: TrolleyInput): Promise<string> {
  const localId = data.localId || genLocalId("trolley"); const rairi = rnd(data.rairiInTrolley);
  const price = rnd(data.trolleyPrice); const rate = Number((price / rairi).toFixed(2));
  const normalized = data.material.toLowerCase().trim(); const batchId = data.batchId;
  const purpose = data.purpose || "factory"; const nowISO = new Date().toISOString();
  const entry: OfflineTrolleyEntry = {
    localId, date: data.date || nowISO, material: data.material.trim(), normalizedMaterial: normalized,
    rairiInTrolley: rairi, rairiRemaining: rairi, rairiLoss: 0, trolleyPrice: price, perRairiRate: rate,
    status: "OPEN", purpose, totalUsed: 0, batchId, userId: data.userId, synced: 0, createdAt: nowISO,
  };
  await offlineDB.transaction("rw", offlineDB.trolleyEntries, offlineDB.trolleyStock, offlineDB.syncQueue, async () => {
    await offlineDB.trolleyEntries.put(entry);
    const existing = await offlineDB.trolleyStock.where("normalizedMaterial").equals(normalized).first();
    if (existing) {
      const newRairi = rnd(existing.totalRairi + rairi); const newCost = rnd(existing.totalCost + price);
      await offlineDB.trolleyStock.update(existing.localId, {
        totalRairi: newRairi, totalCost: newCost,
        avgRate: newRairi > 0 ? Number((newCost / newRairi).toFixed(2)) : rate, updatedAt: nowISO, synced: 0,
      });
    } else {
      const stock: OfflineTrolleyStock = {
        localId: `stock_${normalized}`, material: data.material.trim(), normalizedMaterial: normalized,
        totalRairi: rairi, totalCost: price, avgRate: rate, batchId, userId: data.userId, synced: 0, createdAt: nowISO, updatedAt: nowISO,
      };
      await offlineDB.trolleyStock.put(stock);
    }
    await offlineDB.syncQueue.put({ type: "trolleyEntry", localId, payload: entry, createdAt: new Date(), attempts: 0 });
  });
  return localId;
}

export async function closeTrolleyOffline(data: TrolleyCloseInput): Promise<void> {
  const entry = await offlineDB.trolleyEntries.get(data.localId) || await offlineDB.trolleyEntries.where("localId").equals(data.localId).first();
  if (!entry) return; const actual = rnd(data.actualRairi);
  const newRate = Number((entry.trolleyPrice / actual).toFixed(2));
  const remaining = Math.max(0, actual - (entry.totalUsed || 0));
  const loss = Math.max(0, entry.rairiInTrolley - actual); const nowISO = new Date().toISOString();
  await offlineDB.transaction("rw", offlineDB.trolleyEntries, offlineDB.trolleyStock, offlineDB.syncQueue, async () => {
    await offlineDB.trolleyEntries.update(entry.localId, {
      actualRairi: actual, perRairiRate: newRate, rairiRemaining: remaining, rairiLoss: loss,
      status: "CLOSED", closedAt: nowISO, synced: 0,
    });
    const stock = await offlineDB.trolleyStock.where("normalizedMaterial").equals(entry.normalizedMaterial).first();
    if (stock) {
      const all = await offlineDB.trolleyEntries.where("normalizedMaterial").equals(entry.normalizedMaterial).toArray().catch((): OfflineTrolleyEntry[] => []);
      let totalRairi = 0; let totalCost = 0;
      for (const e of all) {
        const eff = e.localId === entry.localId ? actual : (e.actualRairi || e.rairiInTrolley);
        const rem = Math.max(0, eff - (e.localId === entry.localId ? entry.totalUsed : (e.totalUsed || 0)));
        totalRairi += rem; totalCost += rem * (e.localId === entry.localId ? newRate : (e.perRairiRate || 0));
      }
      await offlineDB.trolleyStock.update(stock.localId, {
        totalRairi: rnd(totalRairi), totalCost: rnd(totalCost),
        avgRate: totalRairi > 0 ? Number((totalCost / totalRairi).toFixed(2)) : newRate, updatedAt: nowISO, synced: 0,
      });
    }
    const closePayload: TrolleyClosePayload = { localId: data.localId, actualRairi: actual, userId: data.userId };
    await offlineDB.syncQueue.put({ 
      type: "trolleyClose", 
      localId: data.localId, 
      payload: closePayload as unknown as OfflinePayload, 
      createdAt: new Date(), 
      attempts: 0 
    });
  });
}

export async function syncOfflineSales(): Promise<{ synced: number }> {
  const sales = await offlineDB.sales.where("synced").equals(0).toArray().catch((): OfflineSale[] => []); let synced = 0;
  for (const s of sales) {
    try {
      const res = await fetch("/api/sales", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNo: s.invoiceNo, customerName: s.customerName, paymentType: s.paymentType,
          date: s.date,
          items: s.items.map((it) => ({
            productId: it.productId, trolleyEntryId: it.trolleyEntryId, productName: it.productName,
            category: it.category, source: it.source, quantity: it.quantity, rairiQty: it.rairiQty,
            sellPrice: it.sellPrice, buyPrice: it.buyPrice,
          })),
          localId: s.localId, userId: s.userId,
        }),
      });
      if (res.ok) { await offlineDB.sales.update(s.localId, { synced: 1 }); await offlineDB.syncQueue.where("localId").equals(s.localId).delete(); synced++; }
    } catch {}
  }
  return { synced };
}

export async function syncAllOffline(): Promise<{ sales: number; blockDaily: number; wusool: number; monthly: number; trolley: number }> {
  if (typeof window === "undefined" || !navigator.onLine) return { sales: 0, blockDaily: 0, wusool: 0, monthly: 0, trolley: 0 };
  const salesResult = await syncOfflineSales();
  const dailyEntries = await offlineDB.blockDaily.where("synced").equals(0).toArray().catch((): OfflineBlockDaily[] => []); let dailySynced = 0;
  for (const d of dailyEntries) {
    try {
      const res = await fetch("/api/block-daily", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: d.date, cementBags: d.cementBags, cementRate: d.cementRate, cementCost: d.cementCost,
          blocksMade: d.blocksMade, blocksCount: d.blocksCount, mazdoorRatePerBlock: d.mazdoorRatePerBlock,
          dailyWages: d.dailyWages, labourCost: d.labourCost, ratePerBlock: d.ratePerBlock,
          blockType: d.blockType, localId: d.localId, userId: d.userId,
          bills: d.bills || [], mixMaterials: d.mixMaterials || [], trolleyMixCost: d.trolleyMixCost,
          mixCost: d.mixCost, totalBill: d.totalBill, isMonthlyElectricity: d.isMonthlyElectricity || false,
        }),
      });
      if (res.ok) { await offlineDB.blockDaily.update(d.localId, { synced: 1 }); await offlineDB.syncQueue.where("localId").equals(d.localId).delete(); dailySynced++; }
    } catch {}
  }
  let wusoolSynced = 0;
  const wusoolQueue = await offlineDB.syncQueue.where("type").equals("wusool").toArray().catch((): SyncQueueItem[] => []);
  for (const q of wusoolQueue) {
    try {
      const payload = q.payload as WusoolSyncPayload & { customerLocalId?: string };
      const cust = payload.customerLocalId ? await offlineDB.customers.get(payload.customerLocalId) : null;
      const customerName = cust ? cust.name : ""; if (!customerName) continue;
      const res = await fetch("/api/customers/wusool", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, amount: payload.amount, note: payload.note || "", localId: q.localId }),
      });
      if (res.ok && q.id !== undefined) { await offlineDB.syncQueue.delete(q.id); wusoolSynced++; }
    } catch {}
  }
  let monthlySynced = 0;
  const monthlyEntries = await offlineDB.monthlyExpenses.where("synced").equals(0).toArray().catch((): MonthlyExpenseLocal[] => []);
  for (const m of monthlyEntries) {
    try {
      const res = await fetch("/api/monthly-expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: m.month, electricity: m.electricity, rent: m.rent, other: m.other,
          totalMonthly: m.totalMonthly, totalBlocks: m.totalBlocks, totalDailyBill: m.totalDailyBill,
          totalMixCost: m.totalMixCost, totalCementCost: m.totalCementCost, totalCementBags: m.totalCementBags,
          totalTrolleyCost: m.totalTrolleyCost, totalLabourCost: m.totalLabourCost,
          costPerBlock: m.costPerBlock, grandCostPerBlock: m.grandCostPerBlock, trueCostPerBlock: m.trueCostPerBlock,
          userId: m.userId, _id: m._id,
        }),
      });
      if (res.ok) { await offlineDB.monthlyExpenses.update(m.month, { synced: 1 }); await offlineDB.syncQueue.where("localId").equals(m.month).delete(); monthlySynced++; }
    } catch {}
  }
  let trolleySynced = 0;
  const trolleyEntries = await offlineDB.trolleyEntries.where("synced").equals(0).toArray().catch((): OfflineTrolleyEntry[] => []);
  for (const t of trolleyEntries) {
    try {
      if (t.status === "CLOSED" && t.actualRairi) {
        const res = await fetch(`${API_TROLLEY}/close`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localId: t.localId, actualRairi: t.actualRairi, userId: t.userId }),
        });
        if (res.ok) { await offlineDB.trolleyEntries.update(t.localId, { synced: 1 }); await offlineDB.syncQueue.where("localId").equals(t.localId).delete(); trolleySynced++; }
      } else {
        const res = await fetch(API_TROLLEY, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            material: t.material, rairiInTrolley: t.rairiInTrolley, trolleyPrice: t.trolleyPrice,
            purpose: t.purpose, date: t.date, localId: t.localId, userId: t.userId,
          }),
        });
        if (res.ok) { await offlineDB.trolleyEntries.update(t.localId, { synced: 1 }); await offlineDB.syncQueue.where("localId").equals(t.localId).delete(); trolleySynced++; }
      }
    } catch {}
  }
  return { sales: salesResult.synced, blockDaily: dailySynced, wusool: wusoolSynced, monthly: monthlySynced, trolley: trolleySynced };
}
if (typeof window !== "undefined") { window.addEventListener("online", () => { void syncAllOffline(); }); }