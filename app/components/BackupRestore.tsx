"use client";
import { useState } from "react";
import { offlineDB } from "@/lib/offline-db";
import type {
  OfflineBlockProduct,
  OfflineSale,
  OfflineCustomer,
  OfflineBlockDaily,
  SyncQueueItem,
} from "@/lib/offline-db";

type BackupData = {
  version?: number;
  date?: string;
  factory?: string;
  blockProducts?: OfflineBlockProduct[];
  products?: OfflineBlockProduct[];
  sales?: OfflineSale[];
  customers?: OfflineCustomer[];
  blockDaily?: OfflineBlockDaily[];
  daily?: OfflineBlockDaily[];
  syncQueue?: SyncQueueItem[];
  counts?: { products: number; sales: number; customers: number; daily: number };
  localStorage?: Record<string, string>;
  data?: BackupData;
};

export default function BackupRestore() {
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  const handleBackup = async () => {
    setLoading(true);
    try {
      const [blockProductsRaw, salesRaw, customersRaw, blockDailyRaw, syncQueue] = await Promise.all([
        offlineDB.blockProducts.toArray(),
        offlineDB.sales.toArray(),
        offlineDB.customers.toArray(),
        offlineDB.blockDaily.toArray(),
        offlineDB.syncQueue.toArray(),
      ]);

      // ✅ Dedup - fixes your 20 -> 10 products issue
      const dedupMap = new Map<string, OfflineBlockProduct>();
      blockProductsRaw.forEach((p) => {
  const key = p._id || p.localId;
  if (!dedupMap.has(key)) dedupMap.set(key, p);
});

      let blockProducts = Array.from(dedupMap.values());
      let sales = salesRaw;
      let customers = customersRaw;
      let blockDaily = blockDailyRaw;

      // ✅ Fetch from server if any table empty and online
      if (typeof window !== "undefined" && window.navigator.onLine) {
        const needServer = blockProducts.length === 0 || sales.length === 0 || customers.length === 0 || blockDaily.length === 0;
        if (needServer) {
          try {
            const res = await fetch("/api/backup/export");
            if (res.ok) {
              const server = (await res.json()) as BackupData;
              if (blockProducts.length === 0) blockProducts = (server.blockProducts || server.products || []) as OfflineBlockProduct[];
              if (sales.length === 0) sales = (server.sales || []) as OfflineSale[];
              if (customers.length === 0) customers = (server.customers || []) as OfflineCustomer[];
              if (blockDaily.length === 0) blockDaily = (server.blockDaily || server.daily || []) as OfflineBlockDaily[];
            }
          } catch {
            // ignore
          }
        }
      }

      if (blockProducts.length === 0 && sales.length === 0 && blockDaily.length === 0 && customers.length === 0) {
        setMsg(`❌ Nothing to backup - offlineDB empty. Create /api/backup/export`);
        setLoading(false);
        return;
      }

      const ls: Record<string, string> = {};
      if (typeof window !== "undefined") {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) ls[key] = window.localStorage.getItem(key) || "";
        }
      }

      const data: BackupData = {
        version: 10,
        date: new Date().toISOString(),
        factory: "MansoorBlockFactoryOfflineV1",
        blockProducts,
        sales,
        customers,
        blockDaily,
        syncQueue,
        localStorage: ls,
        counts: {
          products: blockProducts.length,
          sales: sales.length,
          customers: customers.length,
          daily: blockDaily.length,
        },
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MOHAL-backup-${new Date().toISOString().slice(0, 10)}-${blockProducts.length}p-${blockDaily.length}d-${sales.length}s.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`✅ Backup: ${blockProducts.length} Stock / ${blockDaily.length} Daily / ${sales.length} Bills`);
    } catch (e) {
      setMsg(`❌ Backup failed: ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(""), 5000);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setLoading(true);
  try {
    const text = await file.text();
    let json = JSON.parse(text) as BackupData;
    if (json.data) json = json.data;

    const ensureLocalId = <T extends { _id?: string; localId?: string; id?: string }>(arr: T[]): T[] => {
      return arr.map((item) => ({
        ...item,
        localId: item.localId || item._id || item.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      }));
    };

    const rawProducts = (json.blockProducts || json.products || []) as OfflineBlockProduct[];
    const dedupMap = new Map<string, OfflineBlockProduct>();
    rawProducts.forEach((p) => {
      const key = p._id || p.localId;
      if (!dedupMap.has(key)) dedupMap.set(key, p);
    });

    const blockProducts = ensureLocalId(Array.from(dedupMap.values()));
    const sales = ensureLocalId((json.sales || []) as OfflineSale[]);
    const customers = ensureLocalId((json.customers || []) as OfflineCustomer[]);
    const blockDaily = ensureLocalId((json.blockDaily || json.daily || []) as OfflineBlockDaily[]);
    const syncQueue = (json.syncQueue || []) as SyncQueueItem[];

    if (blockProducts.length === 0 && sales.length === 0 && blockDaily.length === 0 && customers.length === 0) {
      throw new Error(`Empty backup file - keys: ${Object.keys(json).join(", ")}`);
    }

    if (blockProducts.length) {
      await offlineDB.blockProducts.clear();
      await offlineDB.blockProducts.bulkPut(blockProducts);
    }
    if (sales.length) {
      await offlineDB.sales.clear();
      await offlineDB.sales.bulkPut(sales);
    }
    if (customers.length) {
      await offlineDB.customers.clear();
      await offlineDB.customers.bulkPut(customers);
    }
    if (blockDaily.length) {
      await offlineDB.blockDaily.clear();
      await offlineDB.blockDaily.bulkPut(blockDaily);
    }
    if (syncQueue.length) {
      await offlineDB.syncQueue.clear();
      await offlineDB.syncQueue.bulkPut(syncQueue);
    }

    if (json.localStorage && typeof window !== "undefined") {
      Object.entries(json.localStorage).forEach(([k, v]) => {
        try { window.localStorage.setItem(k, v); } catch {}
      });
    }

    // ✅ FIXED: Show Mongo restore result, don't hide error
    if (typeof window !== "undefined" && window.navigator.onLine) {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(`Mongo restore failed: ${result.error || res.statusText}`);
      }
      setMsg(`✅ Restored Offline + Mongo: ${blockProducts.length} Stock / ${blockDaily.length} Daily / ${sales.length} Sales (Mongo Daily: ${result.totalDailyInMongo}) - Reloading...`);
    } else {
      setMsg(`✅ Restored Offline: ${blockProducts.length} Stock / ${blockDaily.length} Daily / ${sales.length} Sales - Reloading...`);
    }
    
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Error";
    setMsg(`❌ Restore failed: ${errMsg}`);
  } finally {
    setLoading(false);
    e.target.value = "";
  }
};

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button onClick={handleBackup} disabled={loading} className="bg-white border px-3 py-2 rounded-xl text-[12px] font-bold">
          {loading ? "⏳" : "💾 Backup"}
        </button>
        <label className="bg-black text-white px-3 py-2 rounded-xl text-[12px] font-bold cursor-pointer">
          ♻️ Restore
          <input type="file" accept=".json" onChange={handleRestore} className="hidden" disabled={loading} />
        </label>
      </div>
      {msg && <p className="text-[11px] font-bold bg-white border p-2 rounded-lg max-w-[320px]">{msg}</p>}
    </div>
  );
}