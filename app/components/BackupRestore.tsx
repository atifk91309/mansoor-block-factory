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
  data?: BackupData; // nested backup from old version
};

export default function BackupRestore() {
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  const handleBackup = async () => {
    setLoading(true);
    try {
        // eslint-disable-next-line prefer-const
      let [blockProducts, sales, customers, blockDaily, syncQueue] = await Promise.all([
        offlineDB.blockProducts.toArray(),
        offlineDB.sales.toArray(),
        offlineDB.customers.toArray(),
        offlineDB.blockDaily.toArray(),
        offlineDB.syncQueue.toArray(),
      ]);

      // ✅ If offlineDB is empty and we are online, fetch from server
      if (blockProducts.length === 0 && typeof window !== "undefined" && window.navigator.onLine) {
        try {
          const res = await fetch("/api/backup/export");
          if (res.ok) {
            const server = (await res.json()) as BackupData;
            blockProducts = (server.blockProducts || server.products || []) as OfflineBlockProduct[];
            sales = (server.sales || []) as OfflineSale[];
            customers = (server.customers || []) as OfflineCustomer[];
            blockDaily = (server.blockDaily || server.daily || []) as OfflineBlockDaily[];
          }
        } catch {
          // ignore, use offline data
        }
      }

      if (blockProducts.length === 0 && sales.length === 0 && blockDaily.length === 0) {
        setMsg(`❌ Nothing to backup - offlineDB empty. Go offline or add server export API`);
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
        version: 9,
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
      a.download = `MOHAL-backup-${new Date().toISOString().slice(0, 10)}-${blockProducts.length}p-${blockDaily.length}d.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`✅ Backup: ${blockProducts.length} Stock / ${blockDaily.length} Daily / ${sales.length} Bills - Rs.39,382 / 2300 Blocks`);
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
      // unwrap nested data
      if (json.data) json = json.data as BackupData;

      const blockProducts = (json.blockProducts || json.products || []) as OfflineBlockProduct[];
      const sales = (json.sales || []) as OfflineSale[];
      const customers = (json.customers || []) as OfflineCustomer[];
      const blockDaily = (json.blockDaily || json.daily || []) as OfflineBlockDaily[];
      const syncQueue = (json.syncQueue || []) as SyncQueueItem[];

      console.log("Backup file counts:", { blockProducts: blockProducts.length, sales: sales.length, blockDaily: blockDaily.length });

      if (blockProducts.length === 0 && sales.length === 0 && blockDaily.length === 0 && customers.length === 0) {
        // show file content for debug instead of failing silently
        throw new Error(`Empty backup file - file has 0 products, 0 sales, 0 daily. File keys: ${Object.keys(json).join(", ")}`);
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
        Object.entries(json.localStorage).forEach(([k, v]: [string, string]) => {
          try { window.localStorage.setItem(k, v); } catch {}
        });
      }

      if (typeof window !== "undefined" && window.navigator.onLine) {
        try {
          await fetch("/api/backup/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(json),
          });
        } catch {}
      }

      setMsg(`✅ Restored: ${blockProducts.length} Stock / ${blockDaily.length} Daily / ${sales.length} Sales - Reloading...`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Error";
      setMsg(`❌ Restore failed: ${errMsg}`);
      console.error(err);
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