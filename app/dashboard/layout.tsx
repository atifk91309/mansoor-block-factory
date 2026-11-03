"use client";
import Link from "next/link";
import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, signOut } from "next-auth/react";
import { offlineDB } from "@/lib/offline-db";
import { clearOfflineUser } from "@/lib/offline-auth";
import { syncAllOffline } from "@/lib/offline-sync";

function useIsOnline(): boolean {
  const sub = useCallback((cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
  }, []);
  const snap = useCallback(() => navigator.onLine, []);
  const ss = useCallback(() => true, []);
  return useSyncExternalStore(sub, snap, ss);
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [pendingBreakdown, setPendingBreakdown] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const isOnline = useIsOnline();
  const pathname = usePathname();

  const isActive = useCallback(
    (href: string): boolean => {
      if (href === "/dashboard") return pathname === "/dashboard";
      return pathname.startsWith(href);
    },
    [pathname]
  );

  const linkClass = (href: string): string =>
    `p-2.5 rounded-lg text-[13px] ${isActive(href) ? "bg-black text-white font-bold" : "hover:bg-zinc-800 text-white/80"}`;

  const handleLogout = async (): Promise<void> => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("offline_mode");
      clearOfflineUser();
    }
    await signOut({ callbackUrl: "/login" });
  };

  const refreshPending = useCallback(async () => {
    try {
      const queue = await offlineDB.syncQueue.toArray().catch(() => []);
      const byType: Record<string, number> = {};
      queue.forEach(q => { byType[q.type] = (byType[q.type] || 0) + 1; });
      const breakdown = Object.entries(byType).map(([k,v]) => `${k}:${v}`).join(" | ");
      setPendingBreakdown(breakdown);

      if (queue.length > 0) {
        setPendingCount(queue.length);
      } else {
        const s = await offlineDB.sales.where("synced").equals(0).count().catch(()=>0);
        const p = await offlineDB.blockProducts.where("synced").equals(0).count().catch(()=>0);
        const d = await offlineDB.blockDaily.where("synced").equals(0).count().catch(()=>0);
        const m = await offlineDB.monthlyExpenses.where("synced").equals(0).count().catch(()=>0);
        const te = await offlineDB.trolleyEntries.where("synced").equals(0).count().catch(()=>0);
        setPendingCount(s + p + d + m + te);
        if (s+p+d+m+te > 0) setPendingBreakdown(`sales:${s} prod:${p} daily:${d} monthly:${m} trolley:${te}`);
      }
    } catch {}
  }, []);

  const handleForceSync = async (): Promise<void> => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await syncAllOffline();
      console.log("force sync", res);
      await refreshPending();
      if (pendingCount > 0) {
        const q = await offlineDB.syncQueue.toArray();
        console.log("still pending queue", q);
      }
    } finally {
      setSyncing(false);
      setTimeout(() => { void refreshPending(); }, 1000);
    }
  };

  const handleClearStuck = async (): Promise<void> => {
    if (!confirm(`Clear ${pendingCount} pending? Use only if data already in MongoDB. This will mark all as synced.`)) return;
    await offlineDB.sales.where("synced").equals(0).modify({synced:1});
    await offlineDB.blockProducts.where("synced").equals(0).modify({synced:1});
    await offlineDB.blockDaily.where("synced").equals(0).modify({synced:1});
    await offlineDB.monthlyExpenses.where("synced").equals(0).modify({synced:1});
    await offlineDB.trolleyEntries.where("synced").equals(0).modify({synced:1}).catch(()=>{});
    await offlineDB.trolleyStock.where("synced").equals(0).modify({synced:1}).catch(()=>{});
    await offlineDB.customers.where("synced").equals(0).modify({synced:1});
    await offlineDB.syncQueue.clear();
    await refreshPending();
    location.reload();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPending();
    const iv = setInterval(() => { void refreshPending(); }, 5000);
    const onOnline = (): void => { void refreshPending(); void syncAllOffline().then(() => void refreshPending()); };
    window.addEventListener("online", onOnline);
    if (navigator.onLine) {
      void syncAllOffline().then(() => void refreshPending());
    }
    return () => {
      clearInterval(iv);
      window.removeEventListener("online", onOnline);
    };
  }, [refreshPending]);

  const isOffline = !isOnline;

  return (
    <div className="min-h-dvh flex bg-gray-50">
      <div className="md:hidden fixed top-0 left-0 right-0 bg-zinc-900 text-white p-3.5 flex justify-between items-center z-30 h-14">
        <h2 className="font-bold text-[14px]">
          🧱 Mansoor Block {isOffline ? "📶 OFF" : ""} {pendingCount > 0 ? `• ${pendingCount} pending` : ""}
        </h2>
        <button onClick={() => setOpen((p) => !p)} className="text-[20px]">
          {open ? "✕" : "☰"}
        </button>
      </div>

      <aside
        className={`w-64 bg-zinc-900 text-white p-5 flex flex-col z-40 fixed md:sticky top-0 left-0 h-dvh shrink-0 transition-transform ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="md:hidden h-14 shrink-0" />
        <div className="mb-6">
          <h2 className="font-bold text-[16px]">🧱 Mansoor Block</h2>
          <p className="text-[10px] text-zinc-400">Factory • Shewa Road • Swabi • Blocks • Rait • Bajri</p>
        </div>

        {pendingCount > 0 && (
          <div className="mb-4 bg-zinc-800 p-2 rounded-lg text-center">
            <div className="text-[11px] font-bold">{pendingCount} pending sync {isOffline ? "• offline" : ""}</div>
            {pendingBreakdown && <div className="text-[8px] text-zinc-400 mt-1">{pendingBreakdown}</div>}
            <div className="flex gap-1 mt-2">
              <button onClick={() => void handleForceSync()} disabled={syncing} className="flex-1 bg-white text-black rounded text-[10px] font-bold py-1">{syncing ? "..." : "↻ Sync Now"}</button>
              <button onClick={() => void handleClearStuck()} className="flex-1 bg-red-600 text-white rounded text-[10px] font-bold py-1">Clear</button>
            </div>
          </div>
        )}

        <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
          <Link href="/dashboard" onClick={() => setOpen(false)} className={linkClass("/dashboard")}>📊 Dashboard</Link>
          <Link href="/dashboard/sales" onClick={() => setOpen(false)} className={linkClass("/dashboard/sales")}>🧱 POS Sale - Blocks</Link>
          <Link href="/dashboard/block-products" onClick={() => setOpen(false)} className={linkClass("/dashboard/block-products")}>📦 Stock - 6 Categories</Link>

          <div className="mt-3 mb-1 text-[10px] text-zinc-500 font-bold tracking-widest pl-2">FACTORY</div>
          <Link href="/dashboard/block-daily" onClick={() => setOpen(false)} className={linkClass("/dashboard/block-daily")}>🏗️ Daily Production</Link>
          <Link href="/dashboard/trolley-stock" onClick={() => setOpen(false)} className={linkClass("/dashboard/trolley-stock")}>🚛 Trolley Stock / ٹرالی</Link>
          <Link href="/dashboard/monthly-expenses" onClick={() => setOpen(false)} className={linkClass("/dashboard/monthly-expenses")}>💡 Monthly Expenses / ماہانہ خرچ</Link>

          <div className="mt-3 mb-1 text-[10px] text-zinc-500 font-bold tracking-widest pl-2">KHATA</div>
          <Link href="/dashboard/customers" onClick={() => setOpen(false)} className={linkClass("/dashboard/customers")}>📒 Khata / Udhar</Link>
          <Link href="/dashboard/sales/history" onClick={() => setOpen(false)} className={linkClass("/dashboard/sales/history")}>📜 Sales History</Link>
        </nav>

        <div className="mt-auto pt-4 border-t border-zinc-800">
          <button onClick={() => void handleLogout()} className="w-full p-2.5 rounded-lg text-[13px] bg-zinc-800 hover:bg-red-600 text-white font-bold transition flex items-center justify-center gap-2">🚪 Logout</button>
          <div className="mt-3 text-[10px] text-zinc-500 text-center">{isOnline ? "🟢 Online" : "🟡 Offline"} • Mansoor Block • Shewa Road</div>
        </div>
      </aside>

      {open && <button onClick={() => setOpen(false)} className="fixed inset-0 bg-black/50 z-30 md:hidden" aria-label="Close menu" />}
      <main className="flex-1 min-w-0 min-h-dvh bg-gray-50 pt-14 md:pt-0">
        <div className="p-3 sm:p-5 w-full max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DashboardShell>{children}</DashboardShell>
    </SessionProvider>
  );
}