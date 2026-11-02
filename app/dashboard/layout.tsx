"use client";
import Link from "next/link";
import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, signOut } from "next-auth/react";
import { offlineDB } from "@/lib/offline-db";
import { clearOfflineUser } from "@/lib/offline-auth";

function useIsOnline() {
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
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const isOnline = useIsOnline();
  const pathname = usePathname();

  const isActive = useCallback(
    (href: string) => {
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

  useEffect(() => {
    const update = async (): Promise<void> => {
      try {
        const s = await offlineDB.sales.where("synced").equals(0).count();
        const p = await offlineDB.blockProducts.where("synced").equals(0).count();
        const d = await offlineDB.blockDaily.where("synced").equals(0).count();
        const w = await offlineDB.syncQueue.where("type").equals("wusool").count();
        setPendingCount(s + p + d + w);
      } catch {}
    };
    void update();
    const iv = setInterval(() => { void update(); }, 5000);
    window.addEventListener("online", update);
    return () => {
      clearInterval(iv);
      window.removeEventListener("online", update);
    };
  }, []);

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
          <div className="mb-4 bg-zinc-800 text-[11px] p-2 rounded-lg text-center">
            {pendingCount} pending sync {isOffline ? "• offline" : ""}
          </div>
        )}

        <nav className="flex flex-col gap-1 flex-1">
          <Link href="/dashboard" onClick={() => setOpen(false)} className={linkClass("/dashboard")}>
            📊 Dashboard
          </Link>
          <Link href="/dashboard/sales" onClick={() => setOpen(false)} className={linkClass("/dashboard/sales")}>
            🧱 POS Sale - Blocks
          </Link>
          <Link href="/dashboard/block-products" onClick={() => setOpen(false)} className={linkClass("/dashboard/block-products")}>
            📦 Stock - 6 Categories
          </Link>

          <div className="mt-3 mb-1 text-[10px] text-zinc-500 font-bold tracking-widest pl-2">FACTORY</div>
          <Link href="/dashboard/block-daily" onClick={() => setOpen(false)} className={linkClass("/dashboard/block-daily")}>
            🏗️ Daily Production
          </Link>

          <div className="mt-3 mb-1 text-[10px] text-zinc-500 font-bold tracking-widest pl-2">KHATA</div>
          <Link href="/dashboard/customers" onClick={() => setOpen(false)} className={linkClass("/dashboard/customers")}>
            📒 Khata / Udhar
          </Link>
          <Link href="/dashboard/sales/history" onClick={() => setOpen(false)} className={linkClass("/dashboard/sales/history")}>
            📜 Sales History
          </Link>
        </nav>

        <div className="mt-auto pt-4 border-t border-zinc-800">
          <button
            onClick={() => void handleLogout()}
            className="w-full p-2.5 rounded-lg text-[13px] bg-zinc-800 hover:bg-red-600 text-white font-bold transition flex items-center justify-center gap-2"
          >
            🚪 Logout
          </button>
          <div className="mt-3 text-[10px] text-zinc-500 text-center">
            {isOnline ? "🟢 Online" : "🟡 Offline"} • Mansoor Block • Shewa Road
          </div>
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