"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";

type SaleItem = { productName: string; category: string; quantity: number; sellPrice: number; buyPrice: number; totalSell: number; totalProfit: number; };

type Sale = {
  _id: string;
  invoiceNo: string;
  customerName: string;
  totalQuantity: number;
  totalSell: number;
  totalProfit: number;
  paymentType: string;
  isUdhar: boolean;
  createdAt: string;
  date: string;
  items: SaleItem[];
};

type FilterType = "today" | "weekly" | "monthly" | "all";
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type SalesApiResponse = { sales: Sale[]; total: number; profit: number; pagination: Pagination };
type CustomerRow = { totalUdhar?: number };

type OfflineSaleDb = {
  localId: string;
  invoiceNo: string;
  customerName: string;
  totalQuantity: number;
  totalSell: number;
  totalProfit: number;
  total: number;
  profit: number;
  quantity: number;
  paymentType: string;
  isUdhar?: boolean;
  status?: string;
  createdAt: string;
  items?: SaleItem[];
  productName: string;
  category: string;
  sellPrice: number;
};

const FILTERS: FilterType[] = ["today", "weekly", "monthly", "all"];

function useIsOnline() {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
  }, []);
  const getSnapshot = useCallback(() => navigator.onLine, []);
  const getServerSnapshot = useCallback(() => true, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
function rnd(n: number) { return Math.round(n || 0); }

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
function isInFilter(dateStr: string, filter: string): boolean {
  if (filter === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  const nowPKT = new Date(now.getTime() + PKT_OFFSET_MS);
  const y = nowPKT.getUTCFullYear(), m = nowPKT.getUTCMonth(), day = nowPKT.getUTCDate();
  const startToday = new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - PKT_OFFSET_MS);
  const endToday = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0) - PKT_OFFSET_MS);
  if (filter === "today") return d >= startToday && d < endToday;
  if (filter === "weekly") return d >= new Date(startToday.getTime() - 7 * 24 * 60 * 60 * 1000) && d < endToday;
  if (filter === "monthly") return d >= new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - PKT_OFFSET_MS) && d < endToday;
  if (filter === "yearly") return d >= new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0) - PKT_OFFSET_MS) && d < endToday;
  return true;
}

export default function SalesHistoryPage() {
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [profit, setProfit] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [filter, setFilter] = useState<FilterType>("today");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "pending">("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, hasMore: false, totalCount: 0 });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(
    async (f: FilterType, s: string, p: number, status: string) => {
      if (p === 1) setLoading(true);
      try {
        if (typeof window !== "undefined" && !window.navigator.onLine) {
          const all = (await offlineDB.sales.orderBy("createdAt").reverse().toArray()) as unknown as OfflineSaleDb[];
          const filtered = all.filter((o) => {
            const inDate = isInFilter(o.createdAt, f);
            const matchSearch =
              !s ||
              o.invoiceNo.toLowerCase().includes(s.toLowerCase()) ||
              o.productName.toLowerCase().includes(s.toLowerCase()) ||
              (o.customerName || "").toLowerCase().includes(s.toLowerCase());
            const isUdhar = o.paymentType === "udhar" || o.isUdhar || o.status === "pending";
            const matchStatus = status === "all" ? true : status === "pending" ? isUdhar : !isUdhar;
            return inDate && matchSearch && matchStatus;
          });
          const paged = filtered.slice((p - 1) * 20, p * 20);
          setSales(
            paged.map((o) => ({
              _id: o.localId,
              invoiceNo: o.invoiceNo,
              customerName: o.customerName,
              totalQuantity: o.totalQuantity || o.quantity,
              totalSell: o.totalSell || o.total,
              totalProfit: o.totalProfit || o.profit,
              paymentType: o.paymentType,
              isUdhar: o.paymentType === "udhar" || !!o.isUdhar,
              createdAt: o.createdAt,
              date: o.createdAt,
              items: o.items || [{ productName: o.productName, category: o.category, quantity: o.quantity, sellPrice: o.sellPrice, buyPrice: 0, totalSell: o.total, totalProfit: o.profit }],
            }))
          );
          const t = filtered.reduce((a, b) => a + (b.totalSell || b.total), 0);
          const pr = filtered.reduce((a, b) => a + (b.totalProfit || b.profit), 0);
          setTotal(rnd(t));
          setProfit(rnd(pr));
          setPagination({ page: p, totalPages: Math.ceil(filtered.length / 20), hasMore: filtered.length > p * 20, totalCount: filtered.length });
          const pendingOffline = all
            .filter((o) => (o.paymentType === "udhar" || o.isUdhar || o.status === "pending") && isInFilter(o.createdAt, f))
            .reduce((a, b) => a + (b.totalSell || b.total), 0);
          setPendingTotal(rnd(pendingOffline));
          return;
        }
        const statusQ = status === "pending" ? "&paymentType=udhar" : status === "paid" ? "&paymentType=cash" : "";
        const res = await fetch(`/api/sales?filter=${f}&search=${encodeURIComponent(s)}&page=${p}&limit=20${statusQ}`);
        const data = (await res.json()) as SalesApiResponse;
        if (p === 1) setSales(data.sales);
        else setSales((prev) => [...prev, ...data.sales]);
        setTotal(rnd(data.total));
        setProfit(rnd(data.profit));
        setPagination(data.pagination);

        try {
          const pendingRes = await fetch(`/api/customers?status=pending&filter=${f}`);
          if (pendingRes.ok) {
            const cData = (await pendingRes.json()) as { customers?: CustomerRow[]; totalUdhar?: number };
            if (typeof cData.totalUdhar === "number") {
              setPendingTotal(rnd(cData.totalUdhar));
            } else {
              const pending = (cData.customers || []).reduce((a, b) => a + (b.totalUdhar || 0), 0);
              setPendingTotal(rnd(pending));
            }
          }
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData(filter, search, page, statusFilter);
  }, [filter, search, page, statusFilter, loadData]);

  const grouped: Record<string, Sale[]> = {};
  sales.forEach((s) => {
    const d = new Date(s.createdAt);
    const pkt = new Date(d.getTime() + PKT_OFFSET_MS);
    const key = pkt.toISOString().slice(0, 10);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  });

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {isOffline && <div className="mb-3 bg-amber-50 border text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 Offline • Showing offline block sales</div>}
      {pendingTotal > 0 && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-[12px] p-2.5 rounded-xl flex justify-between">
          <span>📒 Udhar Pending ({filter}): Rs.{pendingTotal.toLocaleString()}</span>
          <Link href="/dashboard/customers" className="bg-red-600 text-white px-3 py-1 rounded-lg text-[10px]">Khata</Link>
        </div>
      )}

      <div className="flex justify-between mb-4">
        <div>
          <Link href="/dashboard/sales" className="text-[11px] text-gray-500">← POS</Link>
          <h1 className="text-[17px] font-bold">🧱 Mansoor Sales History</h1>
          <p className="text-[11px] text-gray-500">{filter.toUpperCase()} • {pagination.totalCount} bills • Rs.{total.toLocaleString()} • Profit Rs.{profit.toLocaleString()} • Shewa Road</p>
        </div>
        <Link href="/dashboard/sales" className="bg-black text-white px-4 py-2 rounded-xl text-[12px] h-fit">+ New Block Sale</Link>
      </div>

      <div className="bg-white p-3 rounded-xl border mb-4 flex flex-col gap-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => { setFilter(f); setPage(1); }} className={`px-3 py-1.5 rounded-full text-[11px] capitalize ${filter === f ? "bg-black text-white" : "bg-gray-100"}`}>{f}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => { setStatusFilter("all"); setPage(1); }} className={`px-3 py-1.5 rounded-full text-[11px] ${statusFilter === "all" ? "bg-black text-white" : "bg-gray-100"}`}>All</button>
          <button onClick={() => { setStatusFilter("paid"); setPage(1); }} className={`px-3 py-1.5 rounded-full text-[11px] ${statusFilter === "paid" ? "bg-green-600 text-white" : "bg-gray-100"}`}>Cash</button>
          <button onClick={() => { setStatusFilter("pending"); setPage(1); }} className={`px-3 py-1.5 rounded-full text-[11px] ${statusFilter === "pending" ? "bg-red-600 text-white" : "bg-gray-100"}`}>Udhar</button>
        </div>
        <input placeholder="🔍 Search invoice / customer / block type..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="border p-2.5 rounded-lg w-full text-[12px]" />
      </div>

      {loading && page === 1 ? (
        <p className="text-center py-10 text-[12px]">Loading block sales...</p>
      ) : (
        <div className="space-y-3">
          {Object.keys(grouped).length === 0 ? (
            <p className="text-center py-10 bg-white rounded-xl border text-[12px]">No sales — {filter} {statusFilter !== "all" ? `• ${statusFilter}` : ""} • Shewa Road Factory</p>
          ) : (
            Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).map(([date, daySales]) => {
              const dt = daySales.reduce((a, b) => a + b.totalSell, 0);
              const dp = daySales.reduce((a, b) => a + b.totalProfit, 0);
              return (
                <div key={date} className="bg-white rounded-xl border overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 flex justify-between text-[11px] font-bold border-b"><span>{date} • {daySales.length} bills</span><span className="text-green-700">Rs.{rnd(dt).toLocaleString()} <span className="text-blue-600">Profit +{rnd(dp).toLocaleString()}</span></span></div>
                  {daySales.map((s) => (
                    <div key={s._id} className={`px-3 py-2.5 flex justify-between text-[12px] border-b last:border-0 ${s.isUdhar ? "bg-red-50/50" : ""}`}>
                      <div>
                        <p className="font-medium">{s.invoiceNo} • {s.customerName} • {s.items[0]?.productName || "Blocks"} x{s.totalQuantity} {s.isUdhar ? <span className="bg-red-600 text-white px-2 rounded-full text-[9px]">UDHAR</span> : <span className="bg-green-100 px-2 rounded-full text-[9px]">CASH</span>}</p>
                        <p className="text-[10px] text-gray-400">{s.items.map(i => `${i.productName} ${i.quantity}`).join(", ")} • Profit Rs.{s.totalProfit} • {new Date(s.createdAt).toLocaleTimeString()} • {s.items[0]?.category || "block"}</p>
                      </div>
                      <span className="font-bold">Rs.{s.totalSell.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              );
            })
          )}
          {pagination.hasMore && <button onClick={() => setPage((p) => p + 1)} className="w-full py-2.5 bg-white border rounded-xl text-[12px]">Load More ({pagination.totalCount - sales.length})</button>}
        </div>
      )}
      <div className="mt-4 bg-black text-white p-4 rounded-xl flex justify-between"><div><p className="text-[12px] opacity-70">Total {filter} • {pagination.totalCount} bills • Blocks + Rait</p><p className="text-[11px] opacity-60">Profit Rs.{profit.toLocaleString()} • Pending Rs.{pendingTotal.toLocaleString()}</p></div><span className="text-[20px] font-bold">Rs.{total.toLocaleString()}</span></div>
    </div>
  );
}