"use client";
import { useEffect, useState, useCallback, useSyncExternalStore, useRef } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineProduct, PaymentType } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";
import { saveSaleOffline } from "@/lib/offline-sync";

type BlockCategory = "block" | "crush" | "khaka" | "bajri" | "rait" | "cement" | "other";
type Product = {
  _id: string; name: string; category: BlockCategory; buyPrice: number; buyPriceAvg: number; sellPrice: number; stock: number; stockMode: "limited" | "unlimited";
  stockHistory?: { qty: number; date: string; buyPrice: number; sellPrice: number }[];
  lastPurchaseDate?: string;
};
type Sale = {
  _id: string; invoiceNo: string; customerName: string; totalQuantity: number; totalSell: number; totalProfit: number; paymentType: PaymentType; isUdhar: boolean; createdAt: string;
  items: { productName: string; quantity: number }[];
};
type CartItem = { cartId: string; productId: string; name: string; qty: number; price: number; total: number; category: BlockCategory; buyPrice: number; buyPriceAvg: number };
type FilterType = "today" | "weekly" | "monthly" | "all";
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type SalesApiResponse = { sales: Sale[]; pagination: Pagination };
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
  const [mounted, setMounted] = useState(false);
  const [customerError, setCustomerError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const isOnlineHook = useIsOnline();
  const isOffline = mounted && !isOnlineHook;
  const customerInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isProcessing) { e.preventDefault(); e.returnValue = "Sale is processing..."; } };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, [isProcessing]);

  const refreshCounts = useCallback(async () => { try { const c = await offlineDB.sales.where("synced").equals(0).count(); setPendingCount(c); } catch {} }, []);
  const syncPendingSales = useCallback(async () => {
    try {
      if (!navigator.onLine) return;
      const pending = await offlineDB.sales.where("synced").equals(0).toArray();
      if (pending.length === 0) { await refreshCounts(); return; }
      for (const s of pending) {
        try {
          const res = await fetch("/api/sales", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invoiceNo: s.invoiceNo, customerName: s.customerName, paymentType: s.paymentType, date: s.date, items: s.items.map((it) => ({ productId: it.productId, productName: it.productName, category: it.category, quantity: it.quantity, sellPrice: it.sellPrice, buyPrice: it.buyPrice, buyPriceAvg: it.buyPriceAvg })), userId: s.userId, localId: s.localId }),
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
      const data = (await res.json()) as ProductApiResponse; const list = Array.isArray(data) ? data : data.products;
      const offlineUser = getOfflineUser() as OfflineUser; const userId = offlineUser?._id || offlineUser?.id || "offline";
      const toCache: OfflineProduct[] = list.map((p) => ({ _id: p._id, localId: p._id, name: p.name, category: p.category, company: "", buyPrice: p.buyPriceAvg || p.buyPrice, buyPriceAvg: p.buyPriceAvg || p.buyPrice, sellPrice: p.sellPrice, stock: p.stock, stockMode: p.stockMode, userId, synced: 1, createdAt: new Date().toISOString(), stockHistory: p.stockHistory || [], lastPurchaseDate: p.lastPurchaseDate }));
      await offlineDB.products.bulkPut(toCache); alert(`Cached ${toCache.length}`);
    } catch { alert("Cache failed"); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (productPage === 1) setLoadingProducts(true); else setLoadingMoreProducts(true);
      try {
        if (!navigator.onLine) {
          const cached = await offlineDB.products.toArray();
          const filtered = cached.filter((c) => { const s = productSearch.toLowerCase(); return (!s || c.name.toLowerCase().includes(s)) && (categoryFilter === "all" || c.category === categoryFilter); });
          const LIMIT = 20; const paged = filtered.slice(0, productPage * LIMIT);
          const mapped: Product[] = paged.map((c) => ({ _id: c._id || c.localId, name: c.name, category: (c.category as BlockCategory) || "other", buyPrice: c.buyPriceAvg || c.buyPrice, buyPriceAvg: c.buyPriceAvg || c.buyPrice, sellPrice: c.sellPrice, stock: c.stock, stockMode: c.stockMode || "limited", stockHistory: c.stockHistory || [], lastPurchaseDate: c.lastPurchaseDate }));
          if (!cancelled) { setProducts(mapped); setProductPagination({ page: productPage, totalPages: Math.ceil(filtered.length / LIMIT) || 1, hasMore: filtered.length > paged.length, totalCount: filtered.length }); }
        } else {
          const res = await fetch(`/api/block-products?search=${encodeURIComponent(productSearch)}&category=${categoryFilter}&page=${productPage}&limit=20`);
          const data = (await res.json()) as ProductApiResponse; let list: Product[] = []; let pag: Pagination | undefined;
          if (Array.isArray(data)) list = data; else { list = data.products; pag = data.pagination; }
          if (list.length > 0) { const offlineUser = getOfflineUser() as OfflineUser; const userId = offlineUser?._id || offlineUser?.id || "offline"; const toCache: OfflineProduct[] = list.map((p) => ({ _id: p._id, localId: p._id, name: p.name, category: p.category, company: "", buyPrice: p.buyPriceAvg || p.buyPrice, buyPriceAvg: p.buyPriceAvg || p.buyPrice, sellPrice: p.sellPrice, stock: p.stock, stockMode: p.stockMode, userId, synced: 1, createdAt: new Date().toISOString(), stockHistory: p.stockHistory || [], lastPurchaseDate: p.lastPurchaseDate })); await offlineDB.products.bulkPut(toCache).catch(() => {}); }
          if (!cancelled) {
            const mappedList = list.map((p) => ({ _id: p._id, name: p.name, category: p.category as BlockCategory, buyPrice: p.buyPriceAvg || p.buyPrice || 0, buyPriceAvg: p.buyPriceAvg || p.buyPrice || 0, sellPrice: p.sellPrice, stock: p.stock, stockMode: p.stockMode, stockHistory: p.stockHistory || [], lastPurchaseDate: p.lastPurchaseDate }));
            if (productPage === 1) setProducts(mappedList); else setProducts((prev) => [...prev, ...mappedList]); if (pag) setProductPagination(pag);
          }
        }
      } catch {} finally { if (!cancelled) { setLoadingProducts(false); setLoadingMoreProducts(false); } }
    };
    void load(); return () => { cancelled = true; };
  }, [productSearch, categoryFilter, productPage]);

  const loadSales = useCallback(async (f: FilterType, p: number) => {
    setLoadingSales(true);
    try {
      if (!navigator.onLine) {
        const all = await offlineDB.sales.orderBy("createdAt").reverse().toArray(); let filtered = all as unknown as Sale[]; const now = new Date();
        if (f === "today") filtered = filtered.filter((s) => new Date(s.createdAt).toDateString() === now.toDateString());
        if (f === "weekly") { const w = new Date(); w.setDate(now.getDate() - 7); filtered = filtered.filter((s) => new Date(s.createdAt) >= w); }
        if (f === "monthly") { const m = new Date(); m.setMonth(now.getMonth() - 1); filtered = filtered.filter((s) => new Date(s.createdAt) >= m); }
        const sliced = filtered.slice((p - 1) * 20, p * 20); if (p === 1) setSales(sliced); else setSales((prev) => [...prev, ...sliced]); setPagination({ page: p, totalPages: Math.ceil(filtered.length / 20), hasMore: filtered.length > p * 20, totalCount: filtered.length });
      } else { const res = await fetch(`/api/sales?filter=${f}&page=${p}&limit=20`); const data = (await res.json()) as SalesApiResponse; const list = data.sales || []; if (p === 1) setSales(list); else setSales((prev) => [...prev, ...list]); setPagination(data.pagination || { page: p, totalPages: 1, hasMore: false, totalCount: list.length }); }
    } catch {} finally { setLoadingSales(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadSales(filter, page); void refreshCounts(); void syncPendingSales(); }, [filter, page, loadSales, refreshCounts, syncPendingSales]);

  const total = sales.reduce((a, b) => a + b.totalSell, 0);
  const profit = sales.reduce((a, b) => a + b.totalProfit, 0);

  const updateProductPrice = (id: string, val: string) => {
    if (val === "") { setProducts((prev) => prev.map((p) => p._id === id ? { ...p, sellPrice: 0 } : p)); return; }
    const num = Number(val); if (isNaN(num)) return; setProducts((prev) => prev.map((p) => p._id === id ? { ...p, sellPrice: rnd(num) } : p));
  };

  // ✅ HYBRID: block = grouped (1500), crush/khaka etc = single-single
  const addToCart = useCallback((p: Product, qty = 1) => {
    if (p.stockMode === "limited" && p.stock <= 0) { alert(`Out of stock: ${p.name} - Stock 0`); return; }
    if (paymentType === "udhar") { const name = customerName.trim(); if (name.length < 2 || name.toLowerCase() === "walk-in") { setCustomerError(true); alert("Customer name required for Udhar!"); customerInputRef.current?.focus(); return; } }
    setCart((prev) => {
      const totalQtyInCart = prev.filter((c) => c.productId === p._id).reduce((s, c) => s + c.qty, 0);
      if (p.stockMode === "limited" && p.stock < totalQtyInCart + qty) { alert(`Only ${p.stock} left for ${p.name}`); return prev; }
      if (p.category === "block") {
        const exist = prev.find(c => c.productId === p._id && c.price === p.sellPrice);
        if (exist) return prev.map(c => c.cartId === exist.cartId ? { ...c, qty: c.qty + qty, total: rnd((c.qty + qty) * c.price) } : c);
        return [...prev, { cartId: `${p._id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, productId: p._id, name: p.name, qty: rnd(qty), price: p.sellPrice, total: rnd(qty * p.sellPrice), category: p.category, buyPrice: p.buyPriceAvg, buyPriceAvg: p.buyPriceAvg }];
      } else {
        const singles: CartItem[] = [];
        for (let i = 0; i < rnd(qty); i++) singles.push({ cartId: `${p._id}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`, productId: p._id, name: p.name, qty: 1, price: p.sellPrice, total: rnd(p.sellPrice), category: p.category, buyPrice: p.buyPriceAvg, buyPriceAvg: p.buyPriceAvg });
        return [...prev, ...singles];
      }
    });
  }, [paymentType, customerName]);

  const removeFromCart = (cartId: string) => setCart((prev) => prev.filter((c) => c.cartId !== cartId));
  const cartTotal = cart.reduce((s, c) => s + c.total, 0);
  const cartProfit = cart.reduce((s, c) => s + rnd((c.price - c.buyPriceAvg) * c.qty), 0);

  const checkout = useCallback(async () => {
    if (cart.length === 0 || isProcessing) return;
    if (paymentType === "udhar") { const name = customerName.trim(); if (name.length < 2 || name.toLowerCase() === "walk-in") { setCustomerError(true); alert("Customer name required for Udhar!"); customerInputRef.current?.focus(); return; } }
    setIsProcessing(true);
    const finalCustomer = customerName.trim() || "Walk-in"; const copy = [...cart]; const now = new Date().toISOString();
    let sessionUserId = ""; try { const res = await fetch("/api/auth/session"); if (res.ok) { const data = await res.json() as SessionRes; sessionUserId = data?.user?.id || data?.user?._id || ""; } } catch {}
    const offlineUser = getOfflineUser() as OfflineUser; const rawUserId = offlineUser?._id || offlineUser?.id || sessionUserId || "offline_user";
    const invoiceBase = `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    const newSales: Sale[] = copy.map((c) => ({ _id: c.cartId, invoiceNo: `${invoiceBase}_${c.cartId.slice(-4)}`, customerName: finalCustomer, totalQuantity: c.qty, totalSell: c.total, totalProfit: rnd((c.price - c.buyPriceAvg) * c.qty), paymentType, isUdhar: paymentType === "udhar", createdAt: now, items: [{ productName: c.name, quantity: c.qty }] }));
    setSales((prev) => [...newSales, ...prev]); setCart([]);

    try {
      for (const c of copy) {
        await saveSaleOffline({ productId: c.productId, productName: c.name, category: c.category, quantity: c.qty, buyPrice: c.buyPrice, buyPriceAvg: c.buyPriceAvg, sellPrice: c.price, userId: rawUserId, customerName: finalCustomer, paymentType, date: now, localId: c.cartId, invoiceNo: `${invoiceBase}_${c.cartId.slice(-4)}` });
      }
      if (navigator.onLine) {
        for (const c of copy) {
          try { await fetch("/api/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceNo: `${invoiceBase}_${c.cartId.slice(-4)}`, customerName: finalCustomer, paymentType, date: now, items: [{ productId: c.productId, productName: c.name, category: c.category, quantity: c.qty, sellPrice: c.price, buyPrice: c.buyPriceAvg, buyPriceAvg: c.buyPriceAvg }], userId: sessionUserId || rawUserId, localId: c.cartId }) }); } catch {}
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Out of stock"; alert(msg);
      setSales((prev) => prev.filter((s) => !newSales.find((ns) => ns._id === s._id))); setCart(copy); setIsProcessing(false); return;
    }
    await refreshCounts();
    setProducts((prev) => prev.map((prod) => { const soldQty = copy.filter((x) => x.productId === prod._id).reduce((s, x) => s + x.qty, 0); return soldQty > 0 && prod.stockMode === "limited" ? { ...prod, stock: Math.max(0, prod.stock - soldQty) } : prod; }));
    setIsProcessing(false);
  }, [cart, customerName, paymentType, refreshCounts, isProcessing]);

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between gap-2 mb-3">
        <h1 className="font-bold text-[18px]">🧱 Mansoor Block Factory POS {isOffline ? "📶 Offline" : ""} {isProcessing ? "⏳ Processing..." : ""}</h1>
        <div className="flex gap-2">
          <span className="bg-green-600 text-white px-3 py-1 rounded-full text-[11px]">Sale Rs.{fmt(total)}</span>
          <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[11px]">Profit Rs.{fmt(profit)}</span>
          {pendingCount > 0 && <span className="bg-amber-500 text-white px-3 py-1 rounded-full text-[11px]">{pendingCount} pending</span>}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <div className="flex gap-2 mb-2">
            <input value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setProductPage(1); }} placeholder="🔍 Search Block, Crush, Khaka..." className="flex-1 border p-2.5 rounded-xl bg-white text-[13px]" />
            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value as BlockCategory | "all"); setProductPage(1); }} className="border p-2.5 rounded-xl bg-white text-[12px]">
              <option value="all">All 6 Tabs</option><option value="block">🧱 Block</option><option value="crush">Crush</option><option value="khaka">Khaka</option><option value="bajri">Bajri</option><option value="rait">Rait</option><option value="cement">Cement</option><option value="other">Other</option>
            </select>
          </div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] text-gray-500">Showing {products.length}/{productPagination.totalCount} blocks/materials</p>
            {!isOffline && <button onClick={() => void cacheAllProductsOnce()} className="text-[10px] bg-black text-white px-2 py-1 rounded-lg">Cache All for Offline</button>}
          </div>
          {loadingProducts ? <p className="text-center py-6 text-[12px]">Loading...</p> : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {products.map((p) => {
                  const qty = qtyMap[p._id] || 1; const buy = p.buyPriceAvg || p.buyPrice; const isOutOfStock = p.stockMode === "limited" && p.stock <= 0;
                  const cartQty = cart.filter((c) => c.productId === p._id).reduce((s, c) => s + c.qty, 0); const remaining = p.stockMode === "limited" ? Math.max(0, p.stock - cartQty) : 999;
                  return (
                    <div key={p._id} className={`bg-white border rounded-xl p-3 ${isOutOfStock ? "opacity-70 bg-red-50 border-red-200" : ""}`}>
                      <p className="font-bold text-[13px] truncate">{p.name} {isOutOfStock && <span className="text-red-600 text-[10px] ml-1">● OUT</span>}</p>
                      <p className="text-[11px] text-gray-500">{p.category} • Stock {p.stockMode === "unlimited" ? "∞" : p.stock} {!isOutOfStock && p.stockMode === "limited" ? `(Left ${remaining})` : ""} • Buy {fmt(buy)}</p>
                      <div className="flex gap-2 mt-2 items-center">
                        <span className="text-[11px]">Sell Rs.</span>
                        <input type="text" inputMode="numeric" value={p.sellPrice === 0 ? "" : p.sellPrice} onChange={(e) => updateProductPrice(p._id, e.target.value)} placeholder="0" className="w-20 border p-1 rounded-lg text-[12px] font-bold bg-yellow-50" disabled={isOutOfStock || isProcessing} />
                        <span className="text-[10px] text-green-600 font-bold ml-auto">Profit {fmt(p.sellPrice - buy)}</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <div className="flex border rounded-lg overflow-hidden h-8">
                          <button type="button" onClick={() => setQtyMap({ ...qtyMap, [p._id]: Math.max(1, qty - 1) })} className="px-2 bg-gray-100" disabled={isOutOfStock}>-</button>
                          <input type="text" inputMode="numeric" value={qty} onChange={(e) => { const v = e.target.value; if (v === "") { setQtyMap({ ...qtyMap, [p._id]: 1 }); return; } const n = Number(v); if (!isNaN(n) && n >= 1) setQtyMap({ ...qtyMap, [p._id]: Math.floor(n) }); }} className="w-16 text-center text-[12px] font-bold bg-white" />
                          <button type="button" onClick={() => { if (p.stockMode === "limited" && qty >= p.stock) { alert(`Only ${p.stock} left`); return; } setQtyMap({ ...qtyMap, [p._id]: qty + 1 }); }} className="px-2 bg-gray-100" disabled={isOutOfStock}>+</button>
                        </div>
                        <button type="button" onClick={() => addToCart(p, qty)} disabled={isOutOfStock || isProcessing} className={`flex-1 px-3 py-1 rounded-lg text-[11px] font-bold ${isOutOfStock ? "bg-gray-300 text-gray-500" : "bg-black text-white"}`}>{isOutOfStock ? "Out of Stock" : `Add ${qty} x Rs.${fmt(p.sellPrice)}`}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {productPagination.hasMore && <button type="button" onClick={() => setProductPage((pr) => pr + 1)} disabled={loadingMoreProducts} className="w-full mt-3 py-2.5 bg-white border rounded-xl text-[13px] font-bold">Load More</button>}
            </>
          )}
        </div>
        <div className="space-y-3">
          <div className="bg-white border rounded-xl p-3">
            <p className="font-bold text-[13px] mb-2">🧱 Cart ({cart.length}) - Rs.{fmt(cartTotal)}</p>
            <div className="space-y-1 max-h-60 overflow-y-auto mb-3">
              {cart.length === 0 ? <p className="text-[11px] text-gray-400 text-center py-4">Cart empty</p> : cart.map((c) => (<div key={c.cartId} className="flex justify-between text-[11px] border-b py-1.5"><span>{c.name} x{c.qty} @ {fmt(c.price)}</span><span className="flex gap-2"><b>Rs.{fmt(c.total)}</b><button type="button" onClick={() => removeFromCart(c.cartId)} className="text-red-600">✕</button></span></div>))}
            </div>
            <input ref={customerInputRef} value={customerName} onChange={(e) => { setCustomerName(e.target.value); if (e.target.value.trim().length >= 2) setCustomerError(false); }} placeholder="Customer name for Udhar" className={`w-full border p-2 rounded-lg text-[12px] mb-2 ${customerError ? "border-red-500 bg-red-50 ring-2 ring-red-300" : ""}`} />
            {customerError && <p className="text-[10px] text-red-600 mb-2 font-bold">* Customer name required for Udhar</p>}
            <div className="flex bg-gray-100 rounded-lg p-1 mb-3">
              <button type="button" onClick={() => { setPaymentType("cash"); setCustomerError(false); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType === "cash" ? "bg-green-600 text-white" : "text-gray-600"}`}>Cash</button>
              <button type="button" onClick={() => { const name = customerName.trim(); if (name.length < 2 || name.toLowerCase() === "walk-in") { setCustomerError(true); alert("Customer name required for Udhar!"); customerInputRef.current?.focus(); return; } setCustomerError(false); setPaymentType("udhar"); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType === "udhar" ? "bg-red-600 text-white" : "text-gray-600"}`}>Udhar</button>
            </div>
            <button type="button" onClick={() => void checkout()} disabled={cart.length === 0 || isProcessing} className="w-full bg-black text-white py-2.5 rounded-xl font-bold text-[13px] disabled:bg-gray-300">{isProcessing ? "Processing... Please Wait" : paymentType === "udhar" ? `Udhar Rs.${fmt(cartTotal)}` : `Sell Rs.${fmt(cartTotal)} • Profit ${fmt(cartProfit)}`}</button>
            {pendingCount > 0 && <button type="button" onClick={() => void syncPendingSales()} disabled={isProcessing} className="w-full mt-2 bg-amber-500 text-white py-2 rounded-xl font-bold text-[11px]">Sync {pendingCount} Pending Now</button>}
          </div>
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="flex gap-1 p-2 border-b bg-gray-50 overflow-x-auto">{(["today", "weekly", "monthly", "all"] as const).map((f) => <button type="button" key={f} onClick={() => { setFilter(f); setPage(1); }} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${filter === f ? "bg-black text-white" : "bg-white border"}`}>{f}</button>)}</div>
            {loadingSales ? <p className="p-4 text-center text-[11px]">Loading sales...</p> : <div>{sales.map((s) => (<div key={s._id} className={`p-2 border-b flex justify-between text-[11px] ${s.isUdhar ? "bg-red-50" : ""}`}><div><b>{s.invoiceNo}</b> • {s.customerName} • {s.items[0]?.productName || "Blocks"} x{s.totalQuantity}<div className="text-[9px] text-gray-500">{new Date(s.createdAt).toLocaleTimeString()} • Profit {fmt(s.totalProfit)}</div></div><div className="text-right"><div className="font-bold">Rs.{fmt(s.totalSell)}</div><div className={`text-[9px] ${s.isUdhar ? "text-red-600" : "text-green-600"}`}>{s.isUdhar ? "UDHAR" : "Paid"}</div></div></div>))}{pagination.hasMore && <button type="button" onClick={() => setPage((p) => p + 1)} className="w-full py-2 text-[11px] bg-gray-50">Load More</button>}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}