"use client";
import Link from "next/link";
import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, signOut } from "next-auth/react";
import { offlineDB } from "@/lib/offline-db";
import { clearOfflineUser } from "@/lib/offline-auth";
import { syncAllOffline } from "@/lib/offline-sync";
import type { OfflineTrolleyEntry } from "@/lib/offline-db";

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
    `p-2.5 rounded-lg text-[13px] text-right ${isActive(href) ? "bg-black text-white font-bold" : "hover:bg-zinc-800 text-white/80"}`;

  const handleLogout = async (): Promise<void> => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("offline_mode");
      clearOfflineUser();
    }
    await signOut({ callbackUrl: "/login" });
  };

  const refreshPending = useCallback(async () => {
    try {
      const queueAll = await offlineDB.syncQueue.toArray().catch(() => [] as { type: string; localId: string }[]);
      const byType: Record<string, number> = {};
      queueAll.forEach(q => { byType[q.type] = (byType[q.type] || 0) + 1; });
      const breakdown = Object.entries(byType).map(([k,v]) => `${k}:${v}`).join(" | ");
      setPendingBreakdown(breakdown);
      if (queueAll.length > 0) {
        setPendingCount(queueAll.length);
      } else {
        const salesAll = await offlineDB.sales.toArray().catch(()=>[] as { synced?: number }[]);
        const prodsAll = await offlineDB.blockProducts.toArray().catch(()=>[] as { synced?: number }[]);
        const dailyAll = await offlineDB.blockDaily.toArray().catch(()=>[] as { synced?: number }[]);
        const monthlyAll = await offlineDB.monthlyExpenses.toArray().catch(()=>[] as { synced?: number }[]);
        const trolleyAll = await offlineDB.trolleyEntries.toArray().catch(()=>[] as { synced?: number }[]);
        const s = salesAll.filter(o=> o.synced===0).length;
        const p = prodsAll.filter(o=> o.synced===0).length;
        const d = dailyAll.filter(o=> o.synced===0).length;
        const m = monthlyAll.filter(o=> o.synced===0).length;
        const te = trolleyAll.filter(o=> o.synced===0).length;
        setPendingCount(s + p + d + m + te);
        if (s+p+d+m+te > 0) setPendingBreakdown(`فروخت:${s} اسٹاک:${p} روزانہ:${d} ماہانہ:${m} ٹرالی:${te}`);
      }
    } catch {}
  }, []);

  const handleForceSync = async (): Promise<void> => {
    if (syncing) return;
    setSyncing(true);
    try { await syncAllOffline(); await refreshPending(); } finally { setSyncing(false); setTimeout(() => { void refreshPending(); }, 1000); }
  };

  const handleClearStuck = async (): Promise<void> => {
    if (!confirm(`کیا آپ ${pendingCount} زیر التواء کو صاف کرنا چاہتے ہیں؟`)) return;
    const sales = await offlineDB.sales.toArray(); 
    for (const s of sales) { await offlineDB.sales.update(s.localId, { synced: 1 }); }
    const prods = await offlineDB.blockProducts.toArray(); 
    for (const pr of prods) { await offlineDB.blockProducts.update(pr.localId, { synced: 1 }); }
    const daily = await offlineDB.blockDaily.toArray(); 
    for (const dl of daily) { await offlineDB.blockDaily.update(dl.localId, { synced: 1 }); }
    const monthly = await offlineDB.monthlyExpenses.toArray(); 
    for (const mo of monthly) { await offlineDB.monthlyExpenses.update(mo.month, { synced: 1 }); }
    const trolleys = await offlineDB.trolleyEntries.toArray().catch(()=> [] as OfflineTrolleyEntry[]); 
    for (const te of trolleys) { await offlineDB.trolleyEntries.update(te.localId, { synced: 1 }); }
    const allQueue = await offlineDB.syncQueue.toArray(); 
    for (const q of allQueue) { await offlineDB.syncQueue.where("localId").equals(q.localId).delete(); }
    await refreshPending(); location.reload();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPending();
    const iv = setInterval(() => { void refreshPending(); }, 5000);
    const onOnline = (): void => { void refreshPending(); void syncAllOffline().then(() => void refreshPending()); };
    window.addEventListener("online", onOnline);
    if (navigator.onLine) { void syncAllOffline().then(() => void refreshPending()); }
    return () => { clearInterval(iv); window.removeEventListener("online", onOnline); };
  }, [refreshPending]);

  const isOffline = !isOnline;

  return (
    <div className="min-h-dvh flex bg-gray-50" dir="ltr">
      <div className="md:hidden fixed top-0 left-0 right-0 bg-zinc-900 text-white p-3.5 flex justify-between items-center z-30 h-14">
        <button onClick={() => setOpen((p) => !p)} className="text-[20px]">{open ? "✕" : "☰"}</button>
        <h2 className="font-bold text-[14px]">🧱 منصور بلاک {isOffline ? "📶 آف لائن" : ""} {pendingCount > 0 ? `• ${pendingCount} زیر التواء` : ""}</h2>
      </div>

      <aside className={`w-64 bg-zinc-900 text-white p-5 flex flex-col z-40 fixed md:sticky top-0 left-0 h-dvh shrink-0 transition-transform ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="md:hidden h-14 shrink-0" />
        <div className="mb-4 text-left" dir="rtl">
          <h2 className="font-bold text-[16px]">🧱 محل بلاک مٹیریل</h2>
          <p className="text-[10px] text-zinc-400">شیوہ روڈ • صوابی • Frozen 60 ریڑھی = 13000 ÷ 60 = 216.67 روپے</p>
        </div>

        {pendingCount > 0 && (
          <div className="mb-4 bg-zinc-800 p-2 rounded-lg text-center">
            <div className="text-[11px] font-bold">{pendingCount} زیر التواء {isOffline ? "• آف لائن" : ""}</div>
            {pendingBreakdown && <div className="text-[8px] text-zinc-400 mt-1">{pendingBreakdown}</div>}
            <div className="flex gap-1 mt-2">
              <button onClick={() => void handleForceSync()} disabled={syncing} className="flex-1 bg-white text-black rounded text-[10px] font-bold py-1">{syncing ? "..." : "↻ ہم آہنگ کریں"}</button>
              <button onClick={() => void handleClearStuck()} className="flex-1 bg-red-600 text-white rounded text-[10px] font-bold py-1">صاف کریں</button>
            </div>
          </div>
        )}

        <nav className="flex flex-col gap-1 flex-1 overflow-y-auto" dir="rtl">
          <Link href="/dashboard" onClick={() => setOpen(false)} className={linkClass("/dashboard")}>📊 ڈیش بورڈ</Link>
          <Link href="/dashboard/sales" onClick={() => setOpen(false)} className={linkClass("/dashboard/sales")}>🧱 فروخت - POS</Link>
          <Link href="/dashboard/block-products" onClick={() => setOpen(false)} className={linkClass("/dashboard/block-products")}>📦 اسٹاک - 6 اقسام</Link>

          <div className="mt-3 mb-1 text-[10px] text-zinc-500 font-bold tracking-widest pr-2">فیکٹری</div>
          <Link href="/dashboard/block-daily" onClick={() => setOpen(false)} className={linkClass("/dashboard/block-daily")}>🏗️ روزانہ پیداوار</Link>
          <Link href="/dashboard/trolley-stock" onClick={() => setOpen(false)} className={linkClass("/dashboard/trolley-stock")}>🚛 ٹرالی اسٹاک - Frozen 60 ریڑھی</Link>
          <Link href="/dashboard/monthly-expenses" onClick={() => setOpen(false)} className={linkClass("/dashboard/monthly-expenses")}>💡 ماہانہ خرچہ</Link>

          <div className="mt-3 mb-1 text-[10px] text-zinc-500 font-bold tracking-widest pr-2">کھاتہ</div>
          <Link href="/dashboard/customers" onClick={() => setOpen(false)} className={linkClass("/dashboard/customers")}>📒 کھاتہ / ادھار</Link>
          <Link href="/dashboard/sales/history" onClick={() => setOpen(false)} className={linkClass("/dashboard/sales/history")}>📜 فروخت تاریخ</Link>
        </nav>

        <div className="mt-auto pt-4 border-t border-zinc-800">
          <button onClick={() => void handleLogout()} className="w-full p-2.5 rounded-lg text-[13px] bg-zinc-800 hover:bg-red-600 text-white font-bold">🚪 لاگ آؤٹ</button>
          <div className="mt-3 text-[10px] text-zinc-500 text-center" dir="rtl">{isOnline ? "🟢 آن لائن" : "🟡 آف لائن"} • منصور بلاک • Frozen 60</div>
        </div>
      </aside>

      {open && <button onClick={() => setOpen(false)} className="fixed inset-0 bg-black/50 z-30 md:hidden" aria-label="Close menu" />}
      
      <main className="flex-1 min-w-0 min-h-dvh bg-gray-50 pt-14 md:pt-0">
        <div className="p-3 sm:p-5 w-full max-w-7xl mx-auto" dir="rtl">{children}</div>
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