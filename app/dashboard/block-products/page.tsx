"use client";
import { useEffect, useState, useCallback } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineBlockProduct, SyncQueueItem } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";

type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "other";
type StockMode = "limited" | "unlimited";

type StockHistoryItem = {
  qty: number;
  date: string;
  buyPrice: number;
  sellPrice: number;
};

type Product = {
  _id?: string;
  localId: string;
  name: string;
  category: BlockCategory;
  stock: number;
  buyPrice: number;
  buyPriceAvg: number;
  sellPrice: number;
  stockMode: StockMode;
  userId: string;
  synced: number;
  createdAt: string;
  lastPurchaseDate?: string;
  updatedAt?: string;
  stockHistory?: StockHistoryItem[];
};

type OfflineUser = { _id?: string; id?: string } | null;

const categories = ["all", "block", "crush", "khaka", "bajri", "rait", "cement", "other"] as const;
type CategoryFilter = typeof categories[number];

type FormState = {
  name: string;
  category: BlockCategory;
  stock: string;
  buyPriceAvg: string;
  sellPrice: string;
  stockMode: StockMode;
};

type ApiProductsResponse = {
  products?: Product[];
  data?: Product[];
};

export default function BlockProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cat, setCat] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>({
    name: "",
    category: "crush",
    stock: "0",
    buyPriceAvg: "0",
    sellPrice: "80",
    stockMode: "limited",
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  function rnd(n: number): number { return Math.round(Number(n) || 0); }
  function fmtDate(iso?: string): string {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short", hour12: true }); }
    catch { return iso; }
  }
  function toNum(s: string): number { return rnd(s === "" ? 0 : Number(s)); }
  
  // ✅ UNIT LOGIC: Block = Block, rest = trolly
  function getUnitLabel(category: string): string {
    return category.toLowerCase() === "block" ? "Block" : "trolly";
  }

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    async function getUserIdLocal(): Promise<string> {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json() as { user?: { id?: string; _id?: string } };
          if (data?.user?.id) return data.user.id;
          if (data?.user?._id) return data.user._id;
        }
      } catch {}
      const offlineUser = getOfflineUser() as OfflineUser;
      return offlineUser?._id || offlineUser?.id || "offline_user";
    }

    try {
      const cached = await offlineDB.blockProducts.orderBy("createdAt").reverse().toArray();
      if (cached.length > 0) setProducts(cached as unknown as Product[]);
    } catch {}
    try {
      const userId = await getUserIdLocal();
      const url = `/api/block-products?userId=${userId}&category=${cat}&search=${encodeURIComponent(search)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as ApiProductsResponse;
        const list = (data.products || data.data || []) as Product[];
        const mapped = list.map((p) => ({
          ...p,
          localId: p.localId || p._id || `prod_${Date.now()}`,
          synced: 1,
          createdAt: p.createdAt || new Date().toISOString(),
          lastPurchaseDate: p.lastPurchaseDate || p.updatedAt || p.createdAt,
        })) as Product[];
        setProducts(mapped);
        for (const pm of mapped) {
          await offlineDB.blockProducts.put(pm as unknown as OfflineBlockProduct);
        }
      }
    } catch {} finally {
      setIsLoading(false);
    }
  }, [cat, search]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function handleSave(): Promise<void> {
    if (!form.name.trim()) { alert("Name required"); return; }
    setSaving(true);
    
    async function getUserIdLocal(): Promise<string> {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json() as { user?: { id?: string; _id?: string } };
          if (data?.user?.id) return data.user.id;
          if (data?.user?._id) return data.user._id;
        }
      } catch {}
      const offlineUser = getOfflineUser() as OfflineUser;
      return offlineUser?._id || offlineUser?.id || "offline_user";
    }

    const userId = await getUserIdLocal();
    const nowISO = new Date().toISOString();
    const localId = editing || `prod_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const existingSame = products.find((p) => p.name.toLowerCase() === form.name.trim().toLowerCase() && p.category === form.category);

    try {
      if (existingSame && !editing) {
        const addQty = toNum(form.stock);
        const newStock = rnd(existingSame.stock + addQty);
        const historyEntry: StockHistoryItem = { qty: addQty, date: nowISO, buyPrice: toNum(form.buyPriceAvg), sellPrice: toNum(form.sellPrice) };
        const row: Product = {
          ...existingSame,
          stock: newStock,
          buyPrice: toNum(form.buyPriceAvg),
          buyPriceAvg: toNum(form.buyPriceAvg),
          sellPrice: toNum(form.sellPrice),
          lastPurchaseDate: nowISO,
          updatedAt: nowISO,
          synced: 0,
          stockHistory: [...(existingSame.stockHistory || []), historyEntry],
        };
        await offlineDB.blockProducts.put(row as unknown as OfflineBlockProduct);
        await offlineDB.syncQueue.put({
          type: "product",
          localId: existingSame.localId,
          payload: row as unknown as SyncQueueItem["payload"],
          createdAt: new Date(),
          attempts: 0,
        });

        if (navigator.onLine) {
          try {
            await fetch("/api/block-products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                localId: existingSame.localId,
                name: row.name,
                category: row.category,
                stock: addQty,
                buyPrice: row.buyPrice,
                buyPriceAvg: row.buyPriceAvg,
                sellPrice: row.sellPrice,
                userId,
                lastPurchaseDate: nowISO,
              }),
            });
          } catch {}
        }
        alert(`Updated ${row.name}: ${existingSame.stock} + ${addQty} = ${newStock} ${getUnitLabel(row.category)} total`);
      } else {
        const base = editing ? products.find((p) => p.localId === editing) : null;
        const isEdit = !!editing;
        const row: Product = {
          _id: isEdit ? base?._id : undefined,
          localId,
          name: form.name.trim(),
          category: form.category,
          stock: toNum(form.stock),
          buyPrice: toNum(form.buyPriceAvg),
          buyPriceAvg: toNum(form.buyPriceAvg),
          sellPrice: toNum(form.sellPrice),
          stockMode: form.stockMode,
          userId,
          synced: 0,
          createdAt: isEdit ? base?.createdAt || nowISO : nowISO,
          lastPurchaseDate: isEdit ? base?.lastPurchaseDate : nowISO,
          updatedAt: nowISO,
          stockHistory: isEdit ? base?.stockHistory : [{ qty: toNum(form.stock), date: nowISO, buyPrice: toNum(form.buyPriceAvg), sellPrice: toNum(form.sellPrice) }],
        };
        await offlineDB.blockProducts.put(row as unknown as OfflineBlockProduct);
        await offlineDB.syncQueue.put({
          type: "product",
          localId,
          payload: row as unknown as SyncQueueItem["payload"],
          createdAt: new Date(),
          attempts: 0,
        });

        if (navigator.onLine) {
          try {
            if (isEdit && row._id) {
              await fetch(`/api/block-products/${row._id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: row.name,
                  category: row.category,
                  stock: row.stock,
                  stockMode: row.stockMode,
                  buyPrice: row.buyPrice,
                  buyPriceAvg: row.buyPriceAvg,
                  sellPrice: row.sellPrice,
                }),
              });
            } else {
              await fetch("/api/block-products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...row, localId, userId }),
              });
            }
          } catch {}
        }
      }
      setForm({ name: "", category: "crush", stock: "0", buyPriceAvg: "0", sellPrice: "80", stockMode: "limited" });
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      alert("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, dbId?: string): Promise<void> {
    if (!confirm("Delete?")) return;
    try {
      await offlineDB.blockProducts.delete(id);
      await offlineDB.syncQueue.where("localId").equals(id).delete();
      if (dbId) await fetch(`/api/block-products/${dbId}`, { method: "DELETE" });
    } catch {}
    await load();
  }

  function handleCategoryChange(value: string): void {
    const valid: BlockCategory[] = ["khaka","crush","bajri","rait","block","cement","other"];
    if (valid.includes(value as BlockCategory)) setForm((prev) => ({ ...prev, category: value as BlockCategory }));
  }
  function handleStockModeChange(value: string): void {
    if (value === "limited" || value === "unlimited") setForm((prev) => ({ ...prev, stockMode: value as StockMode }));
  }

  const filtered = products.filter((p) => {
    if (cat !== "all" && p.category !== cat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-2 sm:p-4 space-y-3 max-w-6xl mx-auto">
        <h1 className="text-[13px] sm:text-[16px] font-bold px-1">Block Products - 6 Categories Stock - Ismaila</h1>

        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 px-1 scrollbar-hide">
          {categories.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border text-[10px] sm:text-[12px] capitalize shrink-0 ${cat === c ? "bg-black text-white font-bold" : "bg-white"}`}>{c}</button>
          ))}
        </div>

        <div className="flex gap-2 px-1">
          <div className="flex-1">
            <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">Search Product</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Maneray Crush..." className="w-full border p-2 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[13px] mt-1" />
          </div>
          <button onClick={() => void load()} className="border px-3 sm:px-4 py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-[12px] bg-white font-bold self-end h-9 sm:h-10.5">Search</button>
        </div>

        <div className="border rounded-lg sm:rounded-xl p-2.5 sm:p-3 space-y-3 bg-white mx-1 sm:mx-0">
          <h2 className="font-bold text-[11px] sm:text-[13px]">{editing ? "Edit Product - Publish Date stays" : "+ Add New Material / Block"}</h2>
          <div>
            <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">Product Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Maneray Crush" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">Category *</label>
              <select value={form.category} onChange={(e) => handleCategoryChange(e.target.value)} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] capitalize mt-1">
                <option value="block">Block</option><option value="crush">Crush</option><option value="khaka">Khaka</option><option value="bajri">Bajri</option><option value="rait">Rait</option><option value="cement">Cement</option><option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">Stock Mode *</label>
              <select value={form.stockMode} onChange={(e) => handleStockModeChange(e.target.value)} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1">
                <option value="limited">Limited</option><option value="unlimited">Unlimited</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div>
              <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">Today Qty *</label>
              <input type="text" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1" />
            </div>
            <div>
              <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">Buy Price</label>
              <input type="text" inputMode="numeric" value={form.buyPriceAvg} onChange={(e) => setForm({ ...form, buyPriceAvg: e.target.value })} placeholder="0" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1" />
            </div>
            <div>
              <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">Sell Price</label>
              <input type="text" inputMode="numeric" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} placeholder="80" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] font-bold mt-1" />
            </div>
          </div>
          <button onClick={() => void handleSave()} disabled={saving} className="w-full bg-black text-white p-2.5 rounded-lg text-[11px] sm:text-[13px] font-bold disabled:bg-gray-300">
            {saving ? "Saving..." : editing ? "Update - Keep Publish Date" : "Save - With Publish Date/Time"}
          </button>
          {editing && (
            <button onClick={() => { setEditing(null); setForm({ name: "", category: "crush", stock: "0", buyPriceAvg: "0", sellPrice: "80", stockMode: "limited" }); }} className="w-full border py-2 rounded-lg text-[11px] sm:text-[13px]">
              Cancel Edit
            </button>
          )}
        </div>

        {/* ✅ Loading skeleton */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 px-1">
            {[1,2,3].map(i => (
              <div key={i} className="h-35 bg-white border rounded-xl animate-pulse p-3">
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-3"></div>
                <div className="h-2 bg-gray-100 rounded w-full mb-2"></div>
                <div className="h-16 bg-gray-50 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 px-1">
            {filtered.map((p) => {
              const totalAdded = p.stockHistory?.reduce((s,h)=>s+h.qty,0) || 0;
              const totalSold = totalAdded > 0 ? Math.max(0, totalAdded - p.stock) : 0;
              const unit = getUnitLabel(p.category);
              return (
              <div key={p.localId} className="border rounded-xl p-2.5 sm:p-3 bg-white shadow-sm">
                <div className="flex justify-between gap-2">
                  <p className="font-bold text-[11px] sm:text-[13px] leading-tight flex-1 min-w-0 truncate">{p.name} <span className="text-[8px] sm:text-[10px] bg-gray-100 px-1.5 py-0.5 rounded uppercase ml-1">{p.category}</span> <span className="text-[8px]">{p.synced===0?"🟡":"🟢"}</span></p>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setForm({ name: p.name, category: p.category, stock: String(p.stock), buyPriceAvg: String(p.buyPriceAvg), sellPrice: String(p.sellPrice), stockMode: p.stockMode }); setEditing(p.localId); }} className="text-[9px] sm:text-[11px] border px-2 py-1 rounded-lg">Edit</button>
                    <button onClick={() => void handleDelete(p.localId, p._id)} className="text-[9px] sm:text-[11px] bg-red-50 text-red-600 px-2 py-1 rounded-lg">Del</button>
                  </div>
                </div>
                <p className="text-[10px] sm:text-[11px] mt-1 text-gray-700">Stock: {p.stock} {unit} | Buy {p.buyPriceAvg} | Sell Rs.{p.sellPrice} | Value Rs.{p.stock * p.sellPrice}</p>
                <div className="mt-2 bg-gray-50 p-2 rounded-lg text-[9px] sm:text-[10px] space-y-1">
                  <div className="flex justify-between"><span>📅 First Publish:</span><span className="font-bold">{fmtDate(p.createdAt)}</span></div>
                  <div className="flex justify-between"><span>🚚 Last Purchase:</span><span className="font-bold">{fmtDate(p.lastPurchaseDate || p.updatedAt)}</span></div>
                  {p.stockHistory && p.stockHistory.length > 0 && (
                    <div className="border-t pt-2 mt-2">
                      <div className="flex justify-between items-center"><b className="text-[10px] sm:text-[11px]">📋 All Publish Dates:</b><span className="text-[8px] bg-black text-white px-1.5 py-0.5 rounded">{p.stockHistory.length} entries</span></div>
                      {/* ✅ Scrollable + lazy load for long history */}
                      <div className="max-h-27.5 sm:max-h-35 overflow-y-auto mt-1 space-y-1 pr-1">
                        {p.stockHistory.slice(0, 100).map((h, i) => (
                          <div key={i} className="flex justify-between bg-white p-1.5 rounded border text-[10px] sm:text-[11px]">
                            <span>• {h.qty} {unit} @ Buy {h.buyPrice} / Sell {h.sellPrice}</span>
                            <span className="font-bold text-[8px] sm:text-[9px] shrink-0 ml-2">{fmtDate(h.date)}</span>
                          </div>
                        ))}
                      </div>
                      {p.stockHistory.length > 100 && <div className="text-[8px] text-center text-gray-500 mt-1">+{p.stockHistory.length - 100} more in DB, showing latest 100</div>}
                      <div className="font-bold text-[10px] sm:text-[11px] mt-2 bg-black text-white p-1.5 rounded text-center">
                        Added: {totalAdded} | Sold: {totalSold} | Stock: {p.stock} {unit} ✅
                      </div>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
            {filtered.length === 0 && !isLoading && <div className="text-center text-[11px] text-gray-400 py-8 bg-white rounded-xl border">No products found for {cat}</div>}
          </div>
        )}
      </div>
    </div>
  );
}