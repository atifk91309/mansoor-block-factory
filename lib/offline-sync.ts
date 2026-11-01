import { offlineDB, calcProfit, calcTotal } from "./offline-db";
import type { 
  OfflineSale, OfflineSaleItem, OfflineBlockProduct, OfflineBlockDaily, 
  BlockCategory, 
  PaymentType,
  StockHistoryEntry
} from "./offline-db";

export interface SaleInput {
  productId: string;
  productName: string;
  category: BlockCategory;
  quantity: number;
  unit?: string;
  buyPrice: number;
  buyPriceAvg: number;
  sellPrice: number;
  userId: string;
  customerName?: string;
  phone?: string;
  village?: string;
  paymentType?: PaymentType;
  date?: string;
  localId?: string;
  invoiceNo?: string;
}

export interface BlockDailyInput {
  date: string;
  cementBags: number;
  blocksMade: string;
  blocksCount: number;
  dailyWages?: number;
  ratePerBlock?: number;
  blockType?: string;
  userId: string;
  localId?: string;
}

function genLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function rnd(n: number): number {
  return Math.round(n || 0);
}

type SyncableRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

export async function saveSaleOffline(data: SaleInput): Promise<string> {
  const buy = rnd(data.buyPriceAvg || data.buyPrice || 0);
  const sell = rnd(data.sellPrice || 0);
  const qty = rnd(data.quantity || 1);
  const totalSell = calcTotal(sell, qty);
  const totalProfit = calcProfit(sell, buy, qty);
  const isUdhar = data.paymentType === "udhar";
  const status = isUdhar ? "pending" as const : "paid" as const;
  const nowISO = new Date().toISOString();
  const saleDate = data.date || nowISO;
  const localId = data.localId || genLocalId("sale");
  const invoiceNo = data.invoiceNo || `INV-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  const item: OfflineSaleItem = {
    productId: data.productId,
    productName: data.productName,
    category: data.category,
    quantity: qty,
    sellPrice: sell,
    buyPrice: buy,
    buyPriceAvg: buy,
    totalSell,
    totalProfit,
  };

  const sale: OfflineSale = {
    localId,
    invoiceNo,
    date: saleDate,
    customerName: data.customerName || "Walk-in",
    paymentType: (data.paymentType || "cash") as PaymentType,
    isUdhar,
    status,
    totalQuantity: qty,
    totalSell,
    totalProfit,
    userId: data.userId,
    createdAt: nowISO,
    synced: 0,
    items: [item],
    productId: data.productId,
    productName: data.productName,
    category: data.category,
    quantity: qty,
    unit: data.unit || "piece",
    sellPrice: sell,
    buyPrice: buy,
    buyPriceAvg: buy,
    total: totalSell,
    profit: totalProfit,
  };

  await offlineDB.transaction("rw", offlineDB.blockProducts, offlineDB.sales, offlineDB.customers, offlineDB.syncQueue, async () => {
    const byId = await offlineDB.blockProducts.get(data.productId);
    const byLocal = byId ? null : await offlineDB.blockProducts.where("localId").equals(data.productId).first();
    const product = byId || byLocal || await offlineDB.blockProducts.where("_id").equals(data.productId).first();
    
    if (product && product.stockMode === "limited") {
      if (product.stock < qty) {
        throw new Error(`Only ${product.stock} left for ${product.name} - OUT OF STOCK`);
      }
      await offlineDB.blockProducts.update(product.localId, { stock: rnd(product.stock - qty), synced: 0 });
    }

    await offlineDB.sales.put(sale);
    await offlineDB.syncQueue.put({ type: "sale", localId, payload: sale, createdAt: new Date(), attempts: 0 });

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

  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = (await navigator.serviceWorker.ready) as SyncableRegistration;
      if (reg.sync) await reg.sync.register("sync-sales");
    } catch {}
  }
  return localId;
}

export async function saveBlockDailyOffline(data: BlockDailyInput): Promise<string> {
  const localId = data.localId || genLocalId("daily");
  const rate = data.ratePerBlock || 3;
  const count = rnd(data.blocksCount);
  const wages = data.dailyWages || rnd(count * rate);
  const nowISO = new Date().toISOString();

  const daily: OfflineBlockDaily = {
    localId, 
    date: data.date, 
    cementBags: rnd(data.cementBags),
    blocksMade: data.blocksMade.trim(),
    blocksCount: count,
    dailyWages: rnd(wages),
    ratePerBlock: rnd(rate), 
    blockType: data.blockType || "6 inch",
    userId: data.userId, 
    synced: 0, 
    createdAt: nowISO,
  };

  await offlineDB.blockDaily.put(daily);
  await offlineDB.syncQueue.put({ type: "blockDaily", localId, payload: daily, createdAt: new Date(), attempts: 0 });

  try {
    const normalized = data.blocksMade.trim().toLowerCase();
    let blockProduct = await offlineDB.blockProducts.filter((p: OfflineBlockProduct) => p.name.toLowerCase() === normalized).first();
    if (!blockProduct) {
      blockProduct = await offlineDB.blockProducts.where("category").equals("block").filter((p: OfflineBlockProduct) => p.name.toLowerCase().includes((data.blockType || "6").toLowerCase())).first() || undefined;
    }
    if (blockProduct) {
      const historyEntry: StockHistoryEntry = {
        qty: count,
        date: data.date,
        buyPrice: 0,
        sellPrice: 0,
      };
      await offlineDB.blockProducts.update(blockProduct.localId, {
        stock: rnd(blockProduct.stock + count),
        stockHistory: [...(blockProduct.stockHistory || []), historyEntry],
        lastPurchaseDate: data.date,
        synced: 0,
      });
    }
  } catch {}

  return localId;
}

export async function syncOfflineSales(): Promise<{ synced: number }> {
  const sales = await offlineDB.sales.where("synced").equals(0).toArray();
  let synced = 0;
  for (const s of sales) {
    try {
      const res = await fetch("/api/sales", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNo: s.invoiceNo,
          customerName: s.customerName,
          paymentType: s.paymentType,
          date: s.date,
          items: s.items.map((it: OfflineSaleItem) => ({
            productId: it.productId,
            productName: it.productName,
            category: it.category,
            quantity: it.quantity,
            sellPrice: it.sellPrice,
            buyPrice: it.buyPrice,
            buyPriceAvg: it.buyPriceAvg,
          })),
          localId: s.localId, userId: s.userId,
        }),
      });
      if (res.ok) {
        await offlineDB.sales.update(s.localId, { synced: 1 });
        await offlineDB.syncQueue.where("localId").equals(s.localId).delete();
        synced++;
      }
    } catch {}
  }
  return { synced };
}

export async function syncAllOffline(): Promise<{ sales: number; blockDaily: number; wusool: number }> {
  if (typeof window === "undefined" || !navigator.onLine) {
    return { sales: 0, blockDaily: 0, wusool: 0 };
  }
  
  const salesResult = await syncOfflineSales();
  
  const dailyEntries = await offlineDB.blockDaily.where("synced").equals(0).toArray();
  let dailySynced = 0;
  for (const d of dailyEntries) {
    try {
      const res = await fetch("/api/block-daily", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          date: d.date, 
          cementBags: d.cementBags, 
          blocksMade: d.blocksMade,
          blocksCount: d.blocksCount,
          dailyWages: d.dailyWages, 
          ratePerBlock: d.ratePerBlock, 
          blockType: d.blockType, 
          localId: d.localId, 
          userId: d.userId 
        }),
      });
      if (res.ok) {
        await offlineDB.blockDaily.update(d.localId, { synced: 1 });
        await offlineDB.syncQueue.where("localId").equals(d.localId).delete();
        dailySynced++;
      }
    } catch {}
  }

  let wusoolSynced = 0;
  const wusoolQueue = await offlineDB.syncQueue.where("type").equals("wusool").toArray();
  for (const q of wusoolQueue) {
    try {
      const payload = q.payload as { amount: number; note?: string; date: string; customerLocalId?: string };
      const cust = payload.customerLocalId ? await offlineDB.customers.get(payload.customerLocalId) : null;
      const customerName = cust?.name || "";
      if (!customerName) continue;
      const res = await fetch("/api/customers/wusool", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, amount: payload.amount, note: payload.note || "", localId: q.localId }),
      });
      if (res.ok && q.id !== undefined) {
        await offlineDB.syncQueue.delete(q.id);
        wusoolSynced++;
      }
    } catch {}
  }

  return { sales: salesResult.synced, blockDaily: dailySynced, wusool: wusoolSynced };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void syncAllOffline();
  });
}