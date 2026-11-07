"use client";
import { useEffect, useState, useCallback, useSyncExternalStore, useRef } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineBlockProduct, StockUnit, PaymentType, BlockCategory } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";
import { saveSaleOffline, type SaleInput } from "@/lib/offline-sync";

type Product = {
  _id: string; name: string; category: BlockCategory; unit: StockUnit;
  buyPrice: number; buyPriceAvg: number; sellPrice: number; stock: number; stockMode: "limited" | "unlimited";
  stockHistory?: { qty: number; date: string; buyPrice: number; sellPrice: number }[];
  lastPurchaseDate?: string;
};
type Sale = {
  _id: string; invoiceNo: string; customerName: string; totalQuantity: number; totalSell: number; totalProfit: number; paymentType: PaymentType; isUdhar: boolean; createdAt: string;
  items: { productName: string; quantity: number; unit?: string }[];
};
type CartItem = { cartId: string; productId: string; name: string; qty: number; unit: StockUnit; price: number; total: number; category: BlockCategory; buyPrice: number; buyPriceAvg: number };
type FilterType = "today" | "weekly" | "monthly" | "all";
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type SalesApiResponse = { sales: Sale[]; pagination: Pagination; total?: number; profit?: number };
type ProductApiResponse = { products: Product[]; pagination?: Pagination } | Product[];
type OfflineUser = { _id?: string; id?: string } | null;
type SessionRes = { user?: { id?: string; _id?: string } };

function useIsOnline() {
  const sub = useCallback((cb: () => void) => { window.addEventListener("online", cb); window.addEventListener("offline", cb); return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); }; }, []);
  const snap = useCallback(() => navigator.onLine, []);
  const ss = useCallback(() => true, []);
  return useSyncExternalStore(sub, snap, ss);
}
function rnd(n: number): number { return Math.round(n || 0); }
function fmt(n: number): string { return rnd(n).toString(); }

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<FilterType>("today");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, hasMore: false, totalCount: 0 });
  const [productPage, setProductPage] = useState(1);
  const [productPagination, setProductPagination] = useState<Pagination>({ page: 1, totalPages: 1, hasMore: false, totalCount: 0 });
  const [productSearch, setProductSearch] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [loadingSales, setLoadingSales] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<BlockCategory | "all">("all");
  const [customerName, setCustomerName] = useState("Walk-in");
  const [paymentType, setPaymentType] = useState<PaymentType>("cash");
  const [pendingCount, setPendingCount] = useState(0);
  const [customerError, setCustomerError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const pkt = new Date(new Date().getTime() + 5*60*60*1000);
    return pkt.toISOString().slice(0,10);
  });
  const isOnlineHook = useIsOnline();
  const isOffline = !isOnlineHook;
  const customerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isProcessing) { e.preventDefault(); e.returnValue = "فروخت جاری ہے..."; } };
    window.addEventListener("beforeunload", handler); 
    return () => window.removeEventListener("beforeunload", handler);
  }, [isProcessing]);

  const refreshCounts = useCallback(async () => { 
    try { 
      const all = await offlineDB.sales.toArray();
      const c = all.filter(s=> s.synced===0).length;
      setPendingCount(c); 
    } catch {} 
  }, []);

  const syncPendingSales = useCallback(async () => {
    try {
      if (!navigator.onLine) return;
      const pending = await offlineDB.sales.where("synced").equals(0).toArray();
      if (pending.length === 0) { await refreshCounts(); return; }
      for (const s of pending) {
        try {
          const res = await fetch("/api/sales", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              invoiceNo: s.invoiceNo, customerName: s.customerName, paymentType: s.paymentType, date: s.date, 
              items: s.items.map((it) => ({ productId: it.productId, productName: it.productName, category: it.category, quantity: it.quantity, unit: it.unit, sellPrice: it.sellPrice, buyPrice: it.buyPrice })), 
              userId: s.userId, localId: s.localId 
            }),
          });
          if (res.ok) await offlineDB.sales.update(s.localId, { synced: 1 });
        } catch {}
      }
      await refreshCounts();
    } catch {}
  }, [refreshCounts]);

  const cacheAllProductsOnce = useCallback(async () => {
    try {
      const res = await fetch(`/api/block-products?search=&category=all&page=1&limit=500`);
      const data = (await res.json()) as ProductApiResponse; 
      const list = Array.isArray(data) ? data : data.products;
      const offlineUser = getOfflineUser() as OfflineUser; 
      const userId = offlineUser?._id || offlineUser?.id || "offline";
      const toCache = list.map((p) => ({ 
        _id: p._id, localId: p._id, name: p.name, category: p.category, unit: p.unit,
        buyPrice: p.buyPriceAvg || p.buyPrice, buyPriceAvg: p.buyPriceAvg || p.buyPrice, sellPrice: p.sellPrice, stock: p.stock, stockMode: p.stockMode, 
        userId, synced: 1, createdAt: new Date().toISOString(), stockHistory: p.stockHistory || [], lastPurchaseDate: p.lastPurchaseDate,
      } as unknown as OfflineBlockProduct));
      await offlineDB.blockProducts.bulkPut(toCache); 
      alert(`${toCache.length} پراڈکٹ کیش ہو گئے - No Rairi`);
    } catch { alert("کیش ناکام"); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (productPage === 1) setLoadingProducts(true); else setLoadingMoreProducts(true);
      try {
        if (!navigator.onLine) {
          const cached = await offlineDB.blockProducts.toArray();
          const filtered = cached.filter((c) => { const s = productSearch.toLowerCase(); return (!s || c.name.toLowerCase().includes(s)) && (categoryFilter === "all" || c.category === categoryFilter); });
          const LIMIT = 20; const paged = filtered.slice(0, productPage * LIMIT);
          const mapped: Product[] = paged.map((c) => ({ 
            _id: c._id || c.localId, name: c.name, category: (c.category as BlockCategory) || "other", unit: (c.unit as StockUnit) || "trolley",
            buyPrice: c.buyPriceAvg || c.buyPrice, buyPriceAvg: c.buyPriceAvg || c.buyPrice, sellPrice: c.sellPrice, stock: c.stock, stockMode: c.stockMode || "limited",
          }));
          if (!cancelled) { setProducts(mapped); setProductPagination({ page: productPage, totalPages: Math.ceil(filtered.length / LIMIT) || 1, hasMore: filtered.length > paged.length, totalCount: filtered.length }); }
        } else {
          const res = await fetch(`/api/block-products?search=${encodeURIComponent(productSearch)}&category=${categoryFilter}&page=${productPage}&limit=20`);
          const data = (await res.json()) as ProductApiResponse; let list: Product[] = []; let pag: Pagination | undefined;
          if (Array.isArray(data)) list = data; else { list = data.products; pag = data.pagination; }
          if (!cancelled) {
            const mappedList = list.map((p) => ({ 
              _id: p._id, name: p.name, category: p.category as BlockCategory, unit: p.unit as StockUnit,
              buyPrice: p.buyPriceAvg || p.buyPrice || 0, buyPriceAvg: p.buyPriceAvg || p.buyPrice || 0, sellPrice: p.sellPrice, stock: p.stock, stockMode: p.stockMode,
            }));
            if (productPage === 1) setProducts(mappedList); else setProducts((prev) => [...prev, ...mappedList]); if (pag) setProductPagination(pag);
          }
        }
      } catch {} finally { if (!cancelled) { setLoadingProducts(false); setLoadingMoreProducts(false); } }
    };
    void load(); return () => { cancelled = true; };
  }, [productSearch, categoryFilter, productPage]);

  const loadSales = useCallback(async (f: FilterType, p: number, dateStr?: string) => {
    setLoadingSales(true);
    try {
      if (!navigator.onLine) {
        const all = await offlineDB.sales.toArray();
        let filtered = all as unknown as Sale[]; 
        const now = new Date();
        if (dateStr) filtered = filtered.filter((s) => new Date(s.createdAt).toISOString().slice(0,10) === dateStr);
        else if (f === "today") filtered = filtered.filter((s) => new Date(s.createdAt).toDateString() === now.toDateString());
        if (!dateStr) {
          if (f === "weekly") { const w = new Date(); w.setDate(now.getDate() - 7); filtered = filtered.filter((s) => new Date(s.createdAt) >= w); }
          if (f === "monthly") { const m = new Date(); m.setMonth(now.getMonth() - 1); filtered = filtered.filter((s) => new Date(s.createdAt) >= m); }
        }
        filtered = filtered.sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const sliced = filtered.slice((p - 1) * 20, p * 20); 
        if (p === 1) setSales(sliced); else setSales((prev) => [...prev, ...sliced]); 
        setPagination({ page: p, totalPages: Math.ceil(filtered.length / 20), hasMore: filtered.length > p * 20, totalCount: filtered.length });
      } else { 
        const dateQ = dateStr ? `&date=${dateStr}` : "";
        const res = await fetch(`/api/sales?filter=${f}&page=${p}&limit=20${dateQ}`); 
        const data = (await res.json()) as SalesApiResponse; 
        const list = data.sales || []; 
        if (p === 1) setSales(list); else setSales((prev) => [...prev, ...list]); 
        setPagination(data.pagination || { page: p, totalPages: 1, hasMore: false, totalCount: list.length }); 
      }
    } catch {} finally { setLoadingSales(false); }
  }, []);
// eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadSales(filter, page, selectedDate); void refreshCounts(); void syncPendingSales(); }, [filter, page, selectedDate, loadSales, refreshCounts, syncPendingSales]);

  const total = sales.reduce((a, b) => a + b.totalSell, 0);
  const profit = sales.reduce((a, b) => a + b.totalProfit, 0);

  const updateProductPrice = (id: string, val: string) => {
    if (val === "") { setProducts((prev) => prev.map((p) => p._id === id ? { ...p, sellPrice: 0 } : p)); return; }
    const num = Number(val); if (isNaN(num)) return; setProducts((prev) => prev.map((p) => p._id === id ? { ...p, sellPrice: rnd(num) } : p));
  };

  const addToCart = useCallback((p: Product, qty = 1) => {
    if (p.stockMode === "limited" && p.stock <= 0) { alert(`اسٹاک ختم: ${p.name} - اسٹاک 0`); return; }
    if (paymentType === "udhar") { const name = customerName.trim(); if (name.length < 2 || name.toLowerCase() === "walk-in") { setCustomerError(true); alert("ادھار کے لیے گاہک کا نام ضروری ہے!"); customerInputRef.current?.focus(); return; } }
    setCart((prev) => {
      const totalQtyInCart = prev.filter((c) => c.productId === p._id).reduce((s, c) => s + c.qty, 0);
      if (p.stockMode === "limited" && p.stock < totalQtyInCart + qty) { alert(`صرف ${p.stock} باقی ہے ${p.name} کے لیے`); return prev; }
      const exist = prev.find(c => c.productId === p._id && c.price === p.sellPrice && c.unit === p.unit);
      if (exist) return prev.map(c => c.cartId === exist.cartId ? { ...c, qty: c.qty + qty, total: rnd((c.qty + qty) * c.price) } : c);
      return [...prev, { cartId: `${p._id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, productId: p._id, name: p.name, qty: rnd(qty), unit: p.unit, price: p.sellPrice, total: rnd(qty * p.sellPrice), category: p.category, buyPrice: p.buyPriceAvg, buyPriceAvg: p.buyPriceAvg }];
    });
  }, [paymentType, customerName]);

  const removeFromCart = (cartId: string) => setCart((prev) => prev.filter((c) => c.cartId !== cartId));
  const cartTotal = cart.reduce((s, c) => s + c.total, 0);
  const cartProfit = cart.reduce((s, c) => s + rnd((c.price - c.buyPriceAvg) * c.qty), 0);

  const checkout = useCallback(async () => {
    if (cart.length === 0 || isProcessing) return;
    if (paymentType === "udhar") { const name = customerName.trim(); if (name.length < 2 || name.toLowerCase() === "walk-in") { setCustomerError(true); alert("ادھار کے لیے گاہک کا نام ضروری ہے!"); customerInputRef.current?.focus(); return; } }
    setIsProcessing(true);
    const finalCustomer = customerName.trim() || "Walk-in"; const copy = [...cart]; const now = new Date().toISOString();
    let sessionUserId = ""; try { const res = await fetch("/api/auth/session"); if (res.ok) { const data = await res.json() as SessionRes; sessionUserId = data?.user?.id || data?.user?._id || ""; } } catch {}
    const offlineUser = getOfflineUser() as OfflineUser; const rawUserId = offlineUser?._id || offlineUser?.id || sessionUserId || "offline_user";
    const invoiceBase = `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    const newSales: Sale[] = copy.map((c) => ({ 
      _id: c.cartId, 
      invoiceNo: `${invoiceBase}_${c.cartId.slice(-4)}`, 
      customerName: finalCustomer, 
      totalQuantity: c.qty, 
      totalSell: c.total, 
      totalProfit: rnd((c.price - c.buyPriceAvg) * c.qty),
      paymentType: paymentType, 
      isUdhar: paymentType === "udhar", 
      createdAt: now, 
      items: [{ productName: c.name, quantity: c.qty, unit: c.unit }] 
    }));

    setSales((prev) => [...newSales, ...prev]); 
    setCart([]);

    try {
      for (const c of copy) {
        const payload: SaleInput = { 
          productId: c.productId, productName: c.name, category: c.category, source: "block_product",
          quantity: c.qty, unit: c.unit, buyPrice: c.buyPrice, sellPrice: c.price, 
          userId: rawUserId, customerName: finalCustomer, paymentType, date: now, localId: c.cartId, invoiceNo: `${invoiceBase}_${c.cartId.slice(-4)}`,
        };
        await saveSaleOffline(payload);
      }
      if (navigator.onLine) {
        for (const c of copy) {
          try { 
            await fetch("/api/sales", { 
              method: "POST", headers: { "Content-Type": "application/json" }, 
              body: JSON.stringify({ 
                invoiceNo: `${invoiceBase}_${c.cartId.slice(-4)}`, customerName: finalCustomer, paymentType, date: now,
                items: [{ productId: c.productId, productName: c.name, category: c.category, quantity: c.qty, unit: c.unit, sellPrice: c.price, buyPrice: c.buyPriceAvg }], 
                userId: sessionUserId || rawUserId, localId: c.cartId 
              }) 
            }); 
          } catch {}
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "اسٹاک ختم"; alert(msg);
      setSales((prev) => prev.filter((s) => !newSales.find((ns) => ns._id === s._id))); setCart(copy); setIsProcessing(false); return;
    }
    await refreshCounts();
    setProducts((prev) => prev.map((prod) => { const soldQty = copy.filter((x) => x.productId === prod._id).reduce((s, x) => s + x.qty, 0); return soldQty > 0 && prod.stockMode === "limited" ? { ...prod, stock: Math.max(0, prod.stock - soldQty) } : prod; }));
    setIsProcessing(false);
  }, [cart, customerName, paymentType, refreshCounts, isProcessing]);

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 max-w-7xl mx-auto" dir="rtl">
      <div className="flex flex-wrap justify-between gap-2 mb-3">
        <h1 className="font-bold text-[16px]">🧱 محل بلاک مٹیریل - فروخت - No Rairi - trolley/tumper/bori {isOffline ? "📶 آف لائن" : ""} {isProcessing ? "⏳ جاری ہے..." : ""}</h1>
        <div className="flex gap-2">
          <span className="bg-green-600 text-white px-3 py-1 rounded-full text-[11px]">فروخت {fmt(total)} روپے</span>
          <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[11px]">منافع {fmt(profit)} روپے</span>
          {pendingCount > 0 && <span className="bg-amber-500 text-white px-3 py-1 rounded-full text-[11px]">{pendingCount} زیر التواء</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:gap-3">
        {/* LEFT - Products - lg:col-span-2 */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          <div className="flex gap-2 mb-2">
            <input value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setProductPage(1); }} placeholder="🔍 بلاک، کرش تلاش کریں..." className="flex-1 border p-2.5 rounded-xl bg-white text-[13px]" />
            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value as BlockCategory | "all"); setProductPage(1); }} className="border p-2.5 rounded-xl bg-white text-[12px]">
              <option value="all">سب</option><option value="block">🧱 بلاک</option><option value="crush">کرش</option><option value="khaka">خاکہ</option><option value="bajri">بجری</option><option value="rait">ریت</option><option value="cement">سیمنٹ</option><option value="brick">اینٹ</option><option value="other">دیگر</option>
            </select>
          </div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] text-gray-500">{products.length}/{productPagination.totalCount} پراڈکٹ - No Rairi</p>
            {!isOffline && <button onClick={() => void cacheAllProductsOnce()} className="text-[10px] bg-black text-white px-2 py-1 rounded-lg">آف لائن کے لیے کیش کریں</button>}
          </div>
          {loadingProducts ? <p className="text-center py-6 text-[12px]">لوڈ ہو رہا ہے...</p> : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {products.map((p) => {
                  const qty = qtyMap[p._id] || 1; const buy = p.buyPriceAvg || p.buyPrice; const isOutOfStock = p.stockMode === "limited" && p.stock <= 0;
                  const cartQty = cart.filter((c) => c.productId === p._id).reduce((s, c) => s + c.qty, 0); const remaining = p.stockMode === "limited" ? Math.max(0, p.stock - cartQty) : 999;
                  return (
                    <div key={p._id} className={`bg-white border rounded-xl p-3 ${isOutOfStock ? "opacity-70 bg-red-50 border-red-200" : ""}`}>
                      <p className="font-bold text-[13px] truncate">{p.name} {isOutOfStock && <span className="text-red-600 text-[10px] ml-1">● ختم</span>}</p>
                      <p className="text-[11px] text-gray-500">{p.category} • {p.unit} • اسٹاک {p.stockMode === "unlimited" ? "∞" : p.stock} {!isOutOfStock && p.stockMode === "limited" ? `(باقی ${remaining})` : ""}</p>
                      <div className="flex gap-2 mt-2 items-center">
                        <span className="text-[11px]">فروخت فی {p.unit}</span>
                        <input type="text" inputMode="numeric" value={p.sellPrice === 0 ? "" : p.sellPrice} onChange={(e) => updateProductPrice(p._id, e.target.value)} placeholder="0" className="w-20 border p-1 rounded-lg text-[12px] font-bold bg-yellow-50" disabled={isOutOfStock || isProcessing} />
                        <span className="text-[10px] text-green-600 font-bold ml-auto">منافع {fmt(p.sellPrice - buy)}/{p.unit}</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <div className="flex border rounded-lg overflow-hidden h-8">
                          <button type="button" onClick={() => setQtyMap({ ...qtyMap, [p._id]: Math.max(1, qty - 1) })} className="px-2 bg-gray-100" disabled={isOutOfStock}>-</button>
                          <input type="text" inputMode="numeric" value={qty} onChange={(e) => { const v = e.target.value; if (v === "") { setQtyMap({ ...qtyMap, [p._id]: 1 }); return; } const n = Number(v); if (!isNaN(n) && n >= 1) setQtyMap({ ...qtyMap, [p._id]: Math.floor(n) }); }} className="w-16 text-center text-[12px] font-bold bg-white" />
                          <button type="button" onClick={() => { if (p.stockMode === "limited" && qty >= p.stock) { alert(`صرف ${p.stock} باقی ہے`); return; } setQtyMap({ ...qtyMap, [p._id]: qty + 1 }); }} className="px-2 bg-gray-100" disabled={isOutOfStock}>+</button>
                        </div>
                        <button type="button" onClick={() => addToCart(p, qty)} disabled={isOutOfStock || isProcessing} className={`flex-1 px-3 py-1 rounded-lg text-[11px] font-bold ${isOutOfStock ? "bg-gray-300 text-gray-500" : "bg-black text-white"}`}>{isOutOfStock ? "اسٹاک ختم" : `${qty} ${p.unit} شامل x ${fmt(p.sellPrice)} Rs`}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {productPagination.hasMore && <button type="button" onClick={() => setProductPage((pr) => pr + 1)} disabled={loadingMoreProducts} className="w-full mt-3 py-2.5 bg-white border rounded-xl text-[13px] font-bold">مزید لوڈ کریں</button>}
            </>
          )}
        </div>

        {/* RIGHT - Tokri + History TOUCHED */}
        <div className="lg:col-span-1 order-1 lg:order-2 space-y-0 mb-3 lg:mb-0">
          {/* TOKRI */}
          <div className="bg-white border border-b-0 rounded-t-xl rounded-b-none p-3">
            <p className="font-bold text-[13px] mb-2">🧱 ٹوکری ({cart.length}) - {fmt(cartTotal)} روپے</p>
            <div className="space-y-1 max-h-60 overflow-y-auto mb-3">
              {cart.length === 0 ? <p className="text-[11px] text-gray-400 text-center py-4">ٹوکری خالی ہے</p> : cart.map((c) => (<div key={c.cartId} className="flex justify-between text-[11px] border-b py-1.5"><span>{c.name} x{c.qty} {c.unit} @ {fmt(c.price)}</span><span className="flex gap-2"><b>{fmt(c.total)} Rs</b><button type="button" onClick={() => removeFromCart(c.cartId)} className="text-red-600">✕</button></span></div>))}
            </div>
            <input ref={customerInputRef} value={customerName} onChange={(e) => { setCustomerName(e.target.value); if (e.target.value.trim().length >= 2) setCustomerError(false); }} placeholder="گاہک کا نام - ادھار کے لیے ضروری" className={`w-full border p-2 rounded-lg text-[12px] mb-2 ${customerError ? "border-red-500 bg-red-50 ring-2 ring-red-300" : ""}`} />
            {customerError && <p className="text-[10px] text-red-600 mb-2 font-bold">* ادھار کے لیے گاہک کا نام ضروری ہے</p>}
            <div className="flex bg-gray-100 rounded-lg p-1 mb-3">
              <button type="button" onClick={() => { setPaymentType("cash"); setCustomerError(false); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType === "cash" ? "bg-green-600 text-white" : "text-gray-600"}`}>نقد</button>
              <button type="button" onClick={() => { const name = customerName.trim(); if (name.length < 2 || name.toLowerCase() === "walk-in") { setCustomerError(true); alert("ادھار کے لیے گاہک کا نام ضروری ہے!"); customerInputRef.current?.focus(); return; } setCustomerError(false); setPaymentType("udhar"); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType === "udhar" ? "bg-red-600 text-white" : "text-gray-600"}`}>ادھار</button>
            </div>
            <button type="button" onClick={() => void checkout()} disabled={cart.length === 0 || isProcessing} className="w-full bg-black text-white py-2.5 rounded-xl font-bold text-[13px] disabled:bg-gray-300">{isProcessing ? "جاری ہے..." : paymentType === "udhar" ? `ادھار ${fmt(cartTotal)} Rs` : `فروخت ${fmt(cartTotal)} Rs • منافع ${fmt(cartProfit)} Rs`}</button>
            {pendingCount > 0 && <button type="button" onClick={() => void syncPendingSales()} disabled={isProcessing} className="w-full mt-2 bg-amber-500 text-white py-2 rounded-xl font-bold text-[11px]">{pendingCount} زیر التواء ابھی ہم آہنگ کریں</button>}
          </div>

          {/* HISTORY - touch to tokri */}
          <div className="bg-white border border-t-0 rounded-b-xl rounded-t-none p-3 mt-0">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-bold text-[11px]">📋 فروخت تاریخ ({pagination.totalCount})</h2>
              <input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value); setPage(1);}} className="border p-1.5 rounded-lg text-[10px] bg-yellow-50 font-bold w-[130px]" />
            </div>
            <div className="flex gap-1 mb-2">
              {(["today","weekly","monthly","all"] as FilterType[]).map(f=>(
                <button key={f} onClick={()=>{setFilter(f); setPage(1);}} className={`flex-1 py-1 rounded-full text-[9px] font-bold ${filter===f?"bg-black text-white":"bg-gray-100"}`}>{f==="today"?"آج":f==="weekly"?"ہفتہ":f==="monthly"?"مہینہ":"سب"}</button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] font-bold bg-gray-50 p-2 rounded-lg mb-2">
              <span>فروخت {fmt(total)} Rs</span>
              <span className="text-green-600">منافع {fmt(profit)} Rs • {selectedDate}</span>
            </div>
            {loadingSales ? <p className="text-center py-6 text-[10px]">⏳ لوڈ...</p> : sales.length===0 ? (
              <p className="text-center text-[10px] text-gray-400 py-8 border rounded-xl">کوئی فروخت نہیں - {selectedDate}</p>
            ) : (
              <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                {sales.map(s=>(
                  <div key={s._id} className={`p-2.5 border rounded-xl text-[10px] ${s.isUdhar?"bg-red-50 border-red-200":"bg-white"}`}>
                    <div className="flex justify-between">
                      <span className="font-bold truncate">{s.invoiceNo} • {s.customerName}</span>
                      <span className="font-bold">{s.totalSell} Rs</span>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-0.5">{s.items.map(i=>`${i.productName} ${i.quantity}${i.unit||""}`).join(", ")} • {new Date(s.createdAt).toLocaleTimeString("ur-PK")}</p>
                  </div>
                ))}
                {pagination.hasMore && <button onClick={()=>setPage(p=>p+1)} className="w-full py-2 bg-black text-white rounded-xl text-[10px] font-bold">مزید ({pagination.totalCount - sales.length})</button>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}