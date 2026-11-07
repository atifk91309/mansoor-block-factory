"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineBlockDaily } from "@/lib/offline-db";
import BackupRestore from "../components/BackupRestore";

type Product = {
  _id: string;
  name: string;
  category: string;
  sellPrice: number;
  buyPriceAvg: number;
  stock: number;
  stockMode: string;
};

type RecentSale = {
  _id: string;
  invoiceNo: string;
  customerName: string;
  totalSell: number;
  totalProfit: number;
  totalQuantity: number;
  paymentType: string;
  createdAt: string;
  items?: { productName: string; quantity: number }[];
};

type TopItem = { _id: string; totalQty: number; totalSale: number; count: number };

type Block = {
  total: number; profit: number; profitPositive: number; profitNegative: number;
  count: number; cash: number; credit: number; buy: number; blockCount: number;
};

type ReportsApi = {
  today: Block; month: Block; year: Block; all: Block;
  stock: { stockValue: number; stockValueSell: number; lowCount: number; totalStock: number };
  khata: { totalUdhar: number; customers: number; totalWusool: number; wusoolCustomers: number };
  production: {
    today: { totalBlocks: number; totalCement: number; totalWages: number; count: number };
    month: { totalBlocks: number; totalCement: number; totalWages: number; count: number };
    all: { totalBlocks: number; totalCement: number; totalWages: number; count: number };
  };
  categoryBreakdown: { _id: string; total: number; qty: number; count: number }[];
  todayRecent: RecentSale[];
};

type ProductsApiResponse = { products?: Product[]; blockProducts?: Product[] } | Product[];
type TopApiResponse = { top: TopItem[] };

function useIsOnline(): boolean {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  }, []);
  const getSnapshot = useCallback(() => navigator.onLine, []);
  const getServerSnapshot = useCallback(() => true, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function fmt(n: number): string {
  return Math.round(n || 0).toLocaleString();
}

function calcProduction(offlineDaily: OfflineBlockDaily[]) {
  const now = new Date();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const prodToday = { totalBlocks: 0, totalCement: 0, totalWages: 0, count: 0 };
  const prodMonth = { totalBlocks: 0, totalCement: 0, totalWages: 0, count: 0 };
  const prodAll = { totalBlocks: 0, totalCement: 0, totalWages: 0, count: 0 };

  for (const d of offlineDaily) {
    const blocks = Math.round(Number(d.blocksCount) || 0);
    const cement = Math.round(Number(d.cementBags) || 0);
    const wages = Math.round(Number(d.dailyWages) || 0);
    const date = new Date(d.date || d.createdAt);
    prodAll.totalBlocks += blocks; prodAll.totalCement += cement; prodAll.totalWages += wages; prodAll.count++;
    if (date >= startOfMonth) { prodMonth.totalBlocks += blocks; prodMonth.totalCement += cement; prodMonth.totalWages += wages; prodMonth.count++; }
    if (date >= startOfToday) { prodToday.totalBlocks += blocks; prodToday.totalCement += cement; prodToday.totalWages += wages; prodToday.count++; }
  }
  return { today: prodToday, month: prodMonth, all: prodAll };
}

export default function MansoorBlockDashboard() {
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [reports, setReports] = useState<ReportsApi | null>(null);
  const [topProducts, setTopProducts] = useState<TopItem[]>([]);
  const [topFilter, setTopFilter] = useState<"today" | "weekly" | "monthly" | "all">("monthly");
  const [loading, setLoading] = useState<boolean>(true);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        setLoading(true);
        const offlineNow = typeof window !== "undefined" && !window.navigator.onLine;

        // ✅ Hamesha offline daily lo taake 1900 na kho jaye
        const [offlineProds, offlineSales, offlineCustomers, offlineDaily, pendingAll] = await Promise.all([
          offlineDB.blockProducts.toArray(),
          offlineDB.sales.orderBy("createdAt").reverse().toArray(),
          offlineDB.customers.toArray(),
          offlineDB.blockDaily.toArray(),
          offlineDB.sales.where("synced").equals(0).toArray(),
        ]);

        const production = calcProduction(offlineDaily);

        const mappedProds: Product[] = offlineProds.map((p) => ({
          _id: p._id || p.localId,
          name: p.name,
          category: p.category || "other",
          sellPrice: p.sellPrice,
          buyPriceAvg: p.buyPriceAvg,
          stock: p.stock,
          stockMode: p.stockMode || "limited",
        }));

        const mappedSales: RecentSale[] = offlineSales.slice(0, 8).map((s) => ({
          _id: s._id || s.localId,
          invoiceNo: s.invoiceNo,
          customerName: s.customerName,
          totalSell: s.totalSell || s.total,
          totalProfit: s.totalProfit || s.profit,
          totalQuantity: s.totalQuantity || s.quantity,
          paymentType: s.paymentType,
          createdAt: s.createdAt,
          items: s.items.map((it) => ({ productName: it.productName, quantity: it.quantity })),
        }));

        if (offlineNow) {
          setProducts(mappedProds);
          setPendingCount(pendingAll.length);
          setRecentSales(mappedSales);

          const stockValue = mappedProds.reduce((a, p) => a + p.stock * (p.buyPriceAvg || 0), 0);
          const stockValueSell = mappedProds.reduce((a, p) => a + p.stock * p.sellPrice, 0);
          const lowCount = mappedProds.filter((p) => p.stockMode !== "unlimited" && p.stock > 0 && p.stock <= 10).length;
          const totalStock = mappedProds.reduce((a, p) => a + p.stock, 0);
          const totalUdhar = offlineCustomers.filter((c) => !c.isPaid).reduce((a, c) => a + (c.totalUdhar || 0), 0);

          let tT = 0, tP = 0, tC = 0, tBlockCount = 0;
          let mT = 0, mP = 0, mC = 0, mBlockCount = 0;
          let aT = 0, aP = 0, aC = 0, aBlockCount = 0;
          const now = new Date();
          const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

          for (const s of offlineSales) {
            const d = new Date(s.createdAt);
            const sell = s.totalSell || s.total || 0;
            const profit = s.totalProfit || s.profit || 0;
            const qty = s.totalQuantity || s.quantity || 0;
            aT += sell; aP += profit; aC++; aBlockCount += qty;
            if (d >= startOfMonth) { mT += sell; mP += profit; mC++; mBlockCount += qty; }
            if (d >= startOfToday) { tT += sell; tP += profit; tC++; tBlockCount += qty; }
          }

          setReports({
            today: { total: tT, profit: tP, count: tC, profitPositive: tP, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: tBlockCount },
            month: { total: mT, profit: mP, count: mC, profitPositive: mP, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: mBlockCount },
            year: { total: aT, profit: aP, count: aC, profitPositive: aP, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: aBlockCount },
            all: { total: aT, profit: aP, count: aC, profitPositive: aP, profitNegative: 0, buy: 0, cash: 0, credit: 0, blockCount: aBlockCount },
            stock: { stockValue, stockValueSell, lowCount, totalStock },
            khata: { totalUdhar, customers: offlineCustomers.filter((c) => !c.isPaid).length, totalWusool: 0, wusoolCustomers: 0 },
            production,
            categoryBreakdown: [],
            todayRecent: mappedSales,
          });
        } else {
          const [prodRes, reportRes, topRes] = await Promise.all([
            fetch(`/api/block-products?limit=200`, { signal: ctrl.signal }),
            fetch(`/api/reports`, { signal: ctrl.signal }),
            fetch(`/api/sales/top?filter=${topFilter}`, { signal: ctrl.signal }),
          ]);
          const prodJson = await prodRes.json() as ProductsApiResponse;
          const reportJson = await reportRes.json() as ReportsApi;
          const topJson = await topRes.json() as TopApiResponse;

          const productList: Product[] = Array.isArray(prodJson) ? prodJson : prodJson.products || prodJson.blockProducts || [];

          // ✅ FIX: API ka production 0 bhi ho to offline wala 1900 rakh lo
          reportJson.production = production;

          setProducts(productList);
          setReports(reportJson);
          setRecentSales(reportJson.todayRecent || mappedSales);
          setTopProducts(topJson.top || []);
          setPendingCount(pendingAll.length);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    void load();
    return () => ctrl.abort();
  }, [topFilter]);

  if (loading) return <p className="p-8 text-center text-[12px]">منصور بلاک فیکٹری لوڈ ہو رہی ہے...</p>;

  const lowStock = products.filter((p: Product) => p.stockMode !== "unlimited" && p.stock > 0 && p.stock <= 10).slice(0, 6);
  const stockBuy = reports?.stock.stockValue ?? 0;
  const stockSell = reports?.stock.stockValueSell ?? 0;

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50" dir="rtl">
      {isOffline && <div className="mb-3 bg-amber-50 border text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 آف لائن • {pendingCount} زیر التواء — خود ہم آہنگ ہو جائے گا</div>}
      {reports && reports.khata.totalUdhar > 0 && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-[12px] p-2.5 rounded-xl flex justify-between">
          <span>📒 کل ادھار کھاتہ: {fmt(reports.khata.totalUdhar)} روپے • {reports.khata.customers} گاہک</span>
          <Link href="/dashboard/customers" className="bg-red-600 text-white px-3 py-1 rounded-lg text-[11px]">کھاتہ دیکھیں</Link>
        </div>
      )}

      <div className="flex justify-between items-start gap-3 mb-2">
        <div>
          <h1 className="text-[20px] font-bold">🧱 محل بلاک مٹیریل - شیوہ روڈ</h1>
          <p className="text-[11px] text-gray-500">{new Date().toLocaleDateString("ur-PK")} • {isOffline ? "آف لائن" : "آن لائن"} • {reports?.production.all.totalBlocks || 0} بلاک کل پیداوار • فی ریڑھی 1200 روپے</p>
        </div>
        <BackupRestore />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">آج کی فروخت (بلاک + کرش)</p><p className="text-[18px] font-bold">{fmt(reports?.today.total || 0)} روپے</p><p className="text-[10px] text-green-600">منافع {fmt(reports?.today.profit || 0)} روپے • {reports?.today.count || 0} بل • {reports?.today.blockCount || 0} نغ</p></div>
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">اس مہینے کی فروخت</p><p className="text-[18px] font-bold">{fmt(reports?.month.total || 0)} روپے</p><p className="text-[10px] text-blue-600">منافع {fmt(reports?.month.profit || 0)} روپے • {reports?.month.count || 0} بل</p></div>
        <div className="p-4 rounded-xl border-2 border-purple-200 bg-purple-50/50"><p className="text-[10px] text-purple-700 font-bold">سالانہ فروخت (بلاک + کرش)</p><p className="text-[18px] font-bold text-purple-700">{fmt(reports?.year.total || 0)} روپے</p><p className="text-[10px] text-purple-600">منافع {fmt(reports?.year.profit || 0)} روپے • {reports?.year.count || 0} بل • {reports?.year.blockCount || 0} نغ</p></div>
        <div className="bg-white p-4 rounded-xl border border-yellow-300"><p className="text-[10px] text-gray-500 font-bold">اسٹاک مالیت (6 اقسام)</p><p className="text-[18px] font-bold">{fmt(stockBuy)} روپے</p><p className="text-[10px] text-gray-600">فروخت {fmt(stockSell)} روپے • منافع {fmt(stockSell - stockBuy)} روپے</p></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className="bg-white p-4 rounded-xl border-2 border-blue-200"><p className="text-[10px] text-blue-600 font-bold">آج کی پیداوار</p><p className="text-[18px] font-bold">{reports?.production.today.totalBlocks || 0} بلاک</p><p className="text-[10px] text-gray-500">{reports?.production.today.totalCement || 0} بوری سیمنٹ • مزدوری {fmt(reports?.production.today.totalWages || 0)} روپے</p></div>
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl"><p className="text-[10px] text-blue-700 font-bold">مہینے کی پیداوار</p><p className="text-[18px] font-bold">{reports?.production.month.totalBlocks || 0} بلاک</p><p className="text-[10px]">{reports?.production.month.totalCement || 0} بوری • {reports?.production.month.count || 0} دن</p></div>
        <div className="bg-indigo-50 border-indigo-200 p-4 rounded-xl border-2"><p className="text-[10px] text-indigo-700 font-bold">کل پیداوار</p><p className="text-[18px] font-bold text-indigo-700">{reports?.production.all.totalBlocks || 0} بلاک</p><p className="text-[10px] text-indigo-600">{reports?.production.all.totalCement || 0} بوری • {reports?.production.all.count || 0} اندراج • مزدوری {fmt(reports?.production.all.totalWages || 0)} روپے</p></div>
        <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl"><p className="text-[10px] text-orange-700 font-bold">کل ادھار</p><p className="text-[18px] font-bold">{fmt(reports?.khata.totalUdhar || 0)} روپے</p><p className="text-[10px]">{reports?.khata.customers || 0} گاہک • شیوہ، مرغز</p></div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        <Link href="/dashboard/sales" className="bg-black text-white p-4 rounded-xl text-center font-bold text-[13px]">🧱 فروخت</Link>
        <Link href="/dashboard/block-products" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📦 اسٹاک</Link>
        <Link href="/dashboard/block-daily" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">🏗️ روزانہ</Link>
        <Link href="/dashboard/trolley-stock" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">🚛 ٹرالی - ریڑھی</Link>
        <Link href="/dashboard/customers" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📒 کھاتہ</Link>
        <Link href="/dashboard/sales/history" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📜 تاریخ</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="p-3 border-b flex justify-between"><b className="text-[13px]">آج کی حالیہ فروخت - بلاک + کرش</b><span className="text-[10px] bg-green-100 px-2 py-0.5 rounded-full">{recentSales.length} آج</span></div>
          {recentSales.length === 0 ? <p className="p-4 text-[11px] text-gray-400 text-center">آج کوئی فروخت نہیں — شیوہ روڈ فیکٹری</p> : recentSales.map((s, i) => (<div key={`${s._id}-${i}`} className="p-2 border-b flex justify-between text-[11px]"><span><b>{s.invoiceNo}</b> • {s.customerName} • {s.items?.[0]?.productName || "بلاک"} x{s.totalQuantity} <span className="text-[9px] text-gray-500">{new Date(s.createdAt).toLocaleTimeString()}</span></span><span className="font-bold">{fmt(s.totalSell)} روپے</span></div>))}
        </div>

        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="p-3 border-b flex justify-between"><b className="text-[13px]">کم اسٹاک بلاک (≤10)</b><Link href="/dashboard/block-products" className="text-[10px] bg-red-100 px-2 py-0.5 rounded-full">اسٹاک دیکھیں</Link></div>
          {lowStock.length === 0 ? <p className="p-4 text-[11px] text-gray-400 text-center">تمام اسٹاک ٹھیک ہے — {reports?.stock.lowCount || 0} کم • ریت لامحدود</p> : lowStock.map((p, i) => (<div key={`${p._id}-${i}`} className="p-2 border-b flex justify-between text-[11px]"><span><b>{p.name}</b> ({p.category}) • اسٹاک {p.stock} • خرید {fmt(p.buyPriceAvg)} روپے • فروخت {fmt(p.sellPrice)} روپے</span><span className="text-red-600 font-bold">صرف {p.stock} باقی</span></div>))}
          <div className="p-3 border-t">
            <div className="flex gap-1 mb-2">{(["today", "weekly", "monthly", "all"] as const).map((f) => (<button key={f} onClick={() => setTopFilter(f)} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${topFilter === f ? "bg-black text-white" : "bg-gray-100"}`}>{f==="today"?"آج":f==="weekly"?"ہفتہ":f==="monthly"?"مہینہ":"سب"}</button>))}</div>
            {topProducts.slice(0, 5).map((t, i) => (<div key={`${t._id}-${i}`} className="flex justify-between text-[11px] py-1 border-b"><span>{i + 1}. {t._id} • {t.totalQty} نغ</span><span className="font-bold">{fmt(t.totalSale)} روپے</span></div>))}
          </div>
        </div>
      </div>
    </div>
  );
}