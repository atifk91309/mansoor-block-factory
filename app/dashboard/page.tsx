"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";

type Product = { _id: string; name: string; category: string; sellPrice: number; buyPriceAvg: number; stock: number; stockMode: string; };
type RecentSale = { _id: string; invoiceNo: string; customerName: string; totalSell: number; totalProfit: number; totalQuantity: number; paymentType: string; createdAt: string; items?: { productName: string; quantity: number }[] };
type TopItem = { _id: string; totalQty: number; totalSale: number; count: number };
type Block = { total: number; profit: number; profitPositive: number; profitNegative: number; count: number; cash: number; credit: number; buy: number; blockCount: number; };
type ReportsApi = {
  today: Block; month: Block; year: Block; all: Block;
  stock: { stockValue: number; stockValueSell: number; lowCount: number; totalStock: number; };
  khata: { totalUdhar: number; customers: number; totalWusool: number; wusoolCustomers: number; };
  production: { today: { totalBlocks: number; totalCement: number; totalWages: number; count: number }; month: { totalBlocks: number; totalCement: number; totalWages: number; count: number }; all: { totalBlocks: number; totalCement: number; totalWages: number; count: number } };
  categoryBreakdown: { _id: string; total: number; qty: number; count: number }[];
  todayRecent: RecentSale[];
};

type OfflineProduct = { _id?: string; localId: string; name: string; category: string; sellPrice: number; buyPriceAvg: number; stock: number; stockMode: string; };
type OfflineSale = { _id?: string; localId: string; invoiceNo: string; customerName: string; totalSell: number; total: number; totalProfit: number; profit: number; totalQuantity: number; quantity: number; paymentType: string; createdAt: string; items: { productName: string; quantity: number }[]; };
type OfflineCustomer = { isPaid: boolean; totalUdhar: number; };
type ProductsApiResponse = { products?: Product[]; blockProducts?: Product[] } | Product[];
type TopApiResponse = { top: TopItem[] };

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
function fmt(n: number) { return Math.round(n || 0).toLocaleString(); }

export default function MansoorBlockDashboard() {
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [reports, setReports] = useState<ReportsApi | null>(null);
  const [topProducts, setTopProducts] = useState<TopItem[]>([]);
  const [topFilter, setTopFilter] = useState<"today" | "weekly" | "monthly" | "all">("monthly");
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const offlineNow = typeof window !== "undefined" && !window.navigator.onLine;
        if (offlineNow) {
          const offlineProds = (await offlineDB.products.toArray()) as unknown as OfflineProduct[];
          const offlineSales = (await offlineDB.sales.orderBy("createdAt").reverse().toArray()) as unknown as OfflineSale[];
          const offlineCustomers = (await offlineDB.customers.toArray()) as unknown as OfflineCustomer[];
          const pending = await offlineDB.sales.where("synced").equals(0).count();

          const mappedProds: Product[] = offlineProds.map((p) => ({
            _id: p._id || p.localId, name: p.name, category: p.category || "other",
            sellPrice: p.sellPrice, buyPriceAvg: p.buyPriceAvg, stock: p.stock, stockMode: p.stockMode || "limited"
          }));

          setProducts(mappedProds);
          setPendingCount(pending);

          const mappedSales: RecentSale[] = offlineSales.slice(0, 8).map((s) => ({
            _id: s._id || s.localId, invoiceNo: s.invoiceNo, customerName: s.customerName,
            totalSell: s.totalSell || s.total, totalProfit: s.totalProfit || s.profit,
            totalQuantity: s.totalQuantity || s.quantity, paymentType: s.paymentType,
            createdAt: s.createdAt, items: s.items
          }));

          setRecentSales(mappedSales);

          const today = new Date(); today.setHours(0, 0, 0, 0);
          let tT = 0, tP = 0, tC = 0;
          offlineSales.forEach((s) => {
            const d = new Date(s.createdAt);
            if (d >= today) { tT += (s.totalSell || s.total); tP += (s.totalProfit || s.profit); tC++; }
          });

          const stockValue = mappedProds.reduce((a, p) => a + p.stock * (p.buyPriceAvg || 0), 0);
          const stockValueSell = mappedProds.reduce((a, p) => a + p.stock * p.sellPrice, 0);
          const lowCount = mappedProds.filter(p => p.stockMode !== "unlimited" && p.stock > 0 && p.stock <= 10).length;
          const totalUdhar = offlineCustomers.filter(c => !c.isPaid).reduce((a, c) => a + (c.totalUdhar || 0), 0);

          setReports({
            today: { total: tT, profit: tP, count: tC, profitPositive: tP, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: 0 },
            month: { total: 0, profit: 0, count: 0, profitPositive: 0, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: 0 },
            year: { total: 0, profit: 0, count: 0, profitPositive: 0, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: 0 },
            all: { total: 0, profit: 0, count: 0, profitPositive: 0, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: 0 },
            stock: { stockValue, stockValueSell, lowCount, totalStock: 0 },
            khata: { totalUdhar, customers: offlineCustomers.filter(c => !c.isPaid).length, totalWusool: 0, wusoolCustomers: 0 },
            production: { today: { totalBlocks: 0, totalCement: 0, totalWages: 0, count: 0 }, month: { totalBlocks: 0, totalCement: 0, totalWages: 0, count: 0 }, all: { totalBlocks: 0, totalCement: 0, totalWages: 0, count: 0 } },
            categoryBreakdown: [],
            todayRecent: mappedSales,
          });
        } else {
          const [prodRes, reportRes, topRes, pendingArr] = await Promise.all([
            fetch("/api/block-products?limit=200", { signal: ctrl.signal }),
            fetch("/api/reports", { signal: ctrl.signal }),
            fetch(`/api/sales/top?filter=${topFilter}`, { signal: ctrl.signal }),
            offlineDB.sales.where("synced").equals(0).toArray(),
          ]);

          const prodJson = await prodRes.json() as ProductsApiResponse;
          const reportJson = await reportRes.json() as ReportsApi;
          const topJson = await topRes.json() as TopApiResponse;

          const productList: Product[] = Array.isArray(prodJson) ? prodJson : (prodJson.products || prodJson.blockProducts || []);
          setProducts(productList);
          setReports(reportJson);
          setRecentSales(reportJson.todayRecent || []);
          setTopProducts(topJson.top || []);
          setPendingCount(pendingArr.length);
        }
      } catch { } finally { setLoading(false); }
    };
    void load();
    return () => ctrl.abort();
  }, [topFilter]);

  if (loading) return <p className="p-8 text-center text-[12px]">Loading Mansoor Block Factory...</p>;

  const lowStock = products.filter(p => p.stockMode !== "unlimited" && p.stock > 0 && p.stock <= 10).slice(0, 6);
  const stockBuy = reports?.stock.stockValue ?? 0;
  const stockSell = reports?.stock.stockValueSell ?? 0;

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {isOffline && <div className="mb-3 bg-amber-50 border text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 Offline • {pendingCount} pending — will auto-sync</div>}
      {reports && reports.khata.totalUdhar > 0 && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-[12px] p-2.5 rounded-xl flex justify-between">
          <span>📒 Total Udhar Khata: Rs.{fmt(reports.khata.totalUdhar)} • {reports.khata.customers} customers</span>
          <Link href="/dashboard/customers" className="bg-red-600 text-white px-3 py-1 rounded-lg text-[11px]">Khata</Link>
        </div>
      )}

      <h1 className="text-[20px] font-bold">🧱 Mansoor Block Factory - Shewa Road</h1>
      <p className="text-[11px] text-gray-500 mb-4">{new Date().toLocaleDateString()} • {isOffline ? "Offline Mode" : "Online"} • Factory Reports</p>

      {/* ✅ ROW 1 - SALES: Today, Month, Yearly, All */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">Today Sale (Blocks + Crush)</p><p className="text-[18px] font-bold">Rs.{fmt(reports?.today.total || 0)}</p><p className="text-[10px] text-green-600">Profit Rs.{fmt(reports?.today.profit || 0)} • {reports?.today.count || 0} bills • {reports?.today.blockCount || 0} pcs</p></div>
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">This Month Sale</p><p className="text-[18px] font-bold">Rs.{fmt(reports?.month.total || 0)}</p><p className="text-[10px] text-blue-600">Profit Rs.{fmt(reports?.month.profit || 0)} • {reports?.month.count || 0} bills</p></div>
        {/* ✅ NEW - YEARLY SALE */}
        <div className="p-4 rounded-xl border-2 border-purple-200 bg-purple-50/50"><p className="text-[10px] text-purple-700 font-bold">Yearly Sale (Blocks + Crush)</p><p className="text-[18px] font-bold text-purple-700">Rs.{fmt(reports?.year.total || 0)}</p><p className="text-[10px] text-purple-600">Profit Rs.{fmt(reports?.year.profit || 0)} • {reports?.year.count || 0} bills • {reports?.year.blockCount || 0} pcs</p></div>
        <div className="bg-white p-4 rounded-xl border border-yellow-300"><p className="text-[10px] text-gray-500 font-bold">Stock Value (6 Categories)</p><p className="text-[18px] font-bold">Rs.{fmt(stockBuy)}</p><p className="text-[10px] text-gray-600">Sell Rs.{fmt(stockSell)} • Profit Rs.{fmt(stockSell - stockBuy)}</p></div>
      </div>

      {/* ✅ ROW 2 - PRODUCTION: Today, Month, Yearly, All */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className="bg-white p-4 rounded-xl border-2 border-blue-200"><p className="text-[10px] text-blue-600 font-bold">Production Today</p><p className="text-[18px] font-bold">{reports?.production.today.totalBlocks || 0} Blocks</p><p className="text-[10px] text-gray-500">{reports?.production.today.totalCement || 0} Bori Cement • Wages Rs.{fmt(reports?.production.today.totalWages || 0)}</p></div>
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl"><p className="text-[10px] text-blue-700 font-bold">Month Production</p><p className="text-[18px] font-bold">{reports?.production.month.totalBlocks || 0} Blocks</p><p className="text-[10px]">{reports?.production.month.totalCement || 0} Bori • {reports?.production.month.count || 0} days</p></div>
        {/* ✅ NEW - YEARLY PRODUCTION = your 78 Bori / 8386 Blocks */}
        <div className="bg-indigo-50 border-indigo-200 p-4 rounded-xl border-2"><p className="text-[10px] text-indigo-700 font-bold">Yearly Production</p><p className="text-[18px] font-bold text-indigo-700">{reports?.production.all.totalBlocks || 0} Blocks</p><p className="text-[10px] text-indigo-600">{reports?.production.all.totalCement || 0} Bori • {reports?.production.all.count || 0} entries • Wages Rs.{fmt(reports?.production.all.totalWages || 0)}</p></div>
        <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl"><p className="text-[10px] text-orange-700 font-bold">Total Udhar</p><p className="text-[18px] font-bold">Rs.{fmt(reports?.khata.totalUdhar || 0)}</p><p className="text-[10px]">{reports?.khata.customers || 0} customers • Shewa, Marghuz</p></div>
      </div>

      {/* ✅ ROW 3 - VALUES + LOW STOCK */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl"><p className="text-[10px] text-green-700 font-bold">Month Production Value</p><p className="text-[18px] font-bold text-green-700">Rs.{fmt((reports?.production.month.totalBlocks || 0) * 5)}</p><p className="text-[10px]">{reports?.production.month.totalBlocks || 0} Blocks • Cost Rs.{fmt(reports?.production.month.totalCement || 0)} Bori</p></div>
        {/* ✅ NEW - YEARLY PRODUCTION VALUE */}
        <div className="bg-green-100 border border-green-300 p-4 rounded-xl"><p className="text-[10px] text-green-800 font-bold">Yearly Production Value</p><p className="text-[18px] font-bold text-green-800">Rs.{fmt((reports?.production.all.totalBlocks || 0) * 52)}</p><p className="text-[10px]">{reports?.production.all.totalBlocks || 0} Blocks • Cost Rs.52/block</p></div>
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">All Time Sale</p><p className="text-[18px] font-bold">Rs.{fmt(reports?.all.total || 0)}</p><p className="text-[10px] text-gray-500">Profit Rs.{fmt(reports?.all.profit || 0)} • {reports?.all.count || 0} bills</p></div>
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl"><p className="text-[10px] text-yellow-800 font-bold">Low Stock Blocks (≤10)</p><p className="text-[18px] font-bold">{reports?.stock.lowCount || 0} Items</p><p className="text-[10px]">Blocks, Crush, Rait low</p></div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        <Link href="/dashboard/sales" className="bg-black text-white p-4 rounded-xl text-center font-bold text-[13px]">🧱 POS Sale</Link>
        <Link href="/dashboard/block-products" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📦 Stock</Link>
        <Link href="/dashboard/block-daily" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">🏗️ Daily Prod</Link>
        <Link href="/dashboard/customers" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📒 Khata</Link>
        <Link href="/dashboard/sales/history" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📜 History</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="p-3 border-b flex justify-between"><b className="text-[13px]">Today Recent Sales - Blocks + Crush</b><span className="text-[10px] bg-green-100 px-2 py-0.5 rounded-full">{recentSales.length} today</span></div>
          {recentSales.length === 0 ? <p className="p-4 text-[11px] text-gray-400 text-center">No sales today — Shewa Road factory</p> : recentSales.map((s, i) => (
            <div key={i} className="p-2 border-b flex justify-between text-[11px]">
              <span><b>{s.invoiceNo}</b> • {s.customerName} • {s.items?.[0]?.productName || "Blocks"} x{s.totalQuantity} <span className="text-[9px] text-gray-500">{new Date(s.createdAt).toLocaleTimeString()}</span></span>
              <span className="font-bold">Rs.{fmt(s.totalSell)}</span>
            </div>
          ))}
        </div>

        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="p-3 border-b flex justify-between"><b className="text-[13px]">Low Stock Blocks (≤10)</b><Link href="/dashboard/block-products" className="text-[10px] bg-red-100 px-2 py-0.5 rounded-full">Manage Stock</Link></div>
          {lowStock.length === 0 ? <p className="p-4 text-[11px] text-gray-400 text-center">All stock OK — 0 low • Rait unlimited</p> : lowStock.map((p, i) => (
            <div key={i} className="p-2 border-b flex justify-between text-[11px]">
              <span><b>{p.name}</b> ({p.category}) • Stock {p.stock} • Buy Rs.{fmt(p.buyPriceAvg)} • Sell Rs.{fmt(p.sellPrice)}</span>
              <span className="text-red-600 font-bold">Only {p.stock} left</span>
            </div>
          ))}
          <div className="p-3 border-t">
            <div className="flex gap-1 mb-2">{(["today", "weekly", "monthly", "all"] as const).map(f => <button key={f} onClick={() => setTopFilter(f)} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${topFilter === f ? "bg-black text-white" : "bg-gray-100"}`}>{f}</button>)}</div>
            {topProducts.slice(0, 5).map((t, i) => <div key={i} className="flex justify-between text-[11px] py-1 border-b"><span>{i + 1}. {t._id} • {t.totalQty} pcs</span><span className="font-bold">Rs.{fmt(t.totalSale)}</span></div>)}
            {reports?.categoryBreakdown.slice(0, 5).map((t, i) => <div key={i} className="flex justify-between text-[11px] py-1 border-b"><span>{i + 1}. {t._id} • {t.qty} {t._id === "block" ? "blocks" : "trolly"}</span><span className="font-bold">Rs.{fmt(t.total)}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}