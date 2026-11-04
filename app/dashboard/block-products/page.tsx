"use client";
import { useEffect, useState, useCallback } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineBlockProduct, SyncQueueItem } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";

type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "brick" | "other";
type StockMode = "limited" | "unlimited";
type StockHistoryItem = { qty: number; date: string; buyPrice: number; sellPrice: number; rairi?: number; trolleyPrice?: number };

type Product = {
  _id?: string; localId: string; name: string; normalizedName?: string;
  category: BlockCategory; stock: number; buyPrice: number; buyPriceAvg: number;
  sellPrice: number; stockMode: StockMode; userId: string; synced: number;
  createdAt: string; lastPurchaseDate?: string; updatedAt?: string; stockHistory?: StockHistoryItem[];
  rairiPerTrolley?: number;
};
type OfflineUser = { _id?: string; id?: string } | null;

const categories = ["all", "block", "crush", "khaka", "bajri", "rait", "brick", "cement", "other"] as const;
type CategoryFilter = typeof categories[number];
type FormState = { name: string; category: BlockCategory; stock: string; buyPriceAvg: string; sellPrice: string; stockMode: StockMode; rairiPerTrolley: string };
type ApiProductsResponse = { products?: Product[]; data?: Product[] };

const PRESET_GROUPS = [
  { label: "کرش - ٹرالی 60 ریڑھی", category: "crush" as BlockCategory, items: [
    { name: "پن کرش", rairi: 60, buy: 13000, sell: 17000 },
    { name: "ترکے کرش", rairi: 60, buy: 15000, sell: 20000 },
    { name: "منیرے کرش", rairi: 60, buy: 10000, sell: 14000 },
  ]},
  { label: "بلاک - فی بلاک", category: "block" as BlockCategory, items: [
    { name: "شگہ بلاک", rairi: 0, buy: 0, sell: 52 },
    { name: "مکس کرش بلاک", rairi: 0, buy: 0, sell: 55 },
    { name: "فل کرش بلاک", rairi: 0, buy: 0, sell: 58 },
  ]},
  { label: "ریت / شگہ - ٹرالی", category: "rait" as BlockCategory, items: [
    { name: "نرے شگہ شینہ", rairi: 60, buy: 10000, sell: 13000 },
    { name: "نرے شگہ کھڑا", rairi: 60, buy: 10000, sell: 13000 },
    { name: "گھٹہ شگہ", rairi: 55, buy: 12000, sell: 16000 },
  ]},
  { label: "بارز ٹرک - 800 ریڑھی", category: "crush" as BlockCategory, items: [
    { name: "بارز ٹرک پن کرش", rairi: 800, buy: 173333, sell: 226666 },
    { name: "بارز ٹرک ترکے", rairi: 800, buy: 200000, sell: 266666 },
  ]},
  { label: "خاکہ - 100 ریڑھی", category: "khaka" as BlockCategory, items: [
    { name: "سپینہ خاکہ", rairi: 100, buy: 0, sell: 60 },
    { name: "تورہ خاکہ", rairi: 100, buy: 0, sell: 60 },
  ]},
];

export default function BlockProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cat, setCat] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>({ name: "", category: "crush", stock: "60", buyPriceAvg: "13000", sellPrice: "17000", stockMode: "limited", rairiPerTrolley: "60" });
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  function rnd(n: number): number { return Math.round(Number(n) || 0); }
  function fmtDate(iso?: string): string {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString("ur-PK", { dateStyle: "medium", timeStyle: "short", hour12: true }); }
    catch { return iso; }
  }
  function toNum(s: string): number { return rnd(s === "" ? 0 : Number(s)); }
  function getUnitLabel(category: string): string { return category.toLowerCase() === "block" ? "بلاک" : category === "brick" ? "عدد" : "ریڑھی"; }

  function getRates(p: Product) {
    const stock = p.stock;
    const buyTrolley = p.buyPriceAvg;
    const sellTrolley = p.sellPrice;
    const isTrolleyPrice = buyTrolley > 1000 || sellTrolley > 1000;
    const rairiStd = p.rairiPerTrolley && p.rairiPerTrolley > 0 ? p.rairiPerTrolley : 60;
    
    if (isTrolleyPrice) {
      const perRairiBuy = Number((buyTrolley / rairiStd).toFixed(2));
      const perRairiSell = Number((sellTrolley / rairiStd).toFixed(2));
      return {
        perRairiBuy, perRairiSell,
        totalBuy: Math.round((stock / rairiStd) * buyTrolley),
        totalSell: Math.round((stock / rairiStd) * sellTrolley),
        label: `${rairiStd} ریڑھی = 1 ٹرالی`
      };
    } else {
      return {
        perRairiBuy: buyTrolley, perRairiSell: sellTrolley,
        totalBuy: stock * buyTrolley,
        totalSell: stock * sellTrolley,
        label: `فی ریڑھی`
      };
    }
  }

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    async function getUserIdLocal(): Promise<string> {
      try { const res = await fetch("/api/auth/session"); if (res.ok) { const data = await res.json() as { user?: { id?: string; _id?: string } }; if (data?.user?.id) return data.user.id; if (data?.user?._id) return data.user._id; } } catch {}
      const offlineUser = getOfflineUser() as OfflineUser; return offlineUser?._id || offlineUser?.id || "offline_user";
    }
    try { const cached = await offlineDB.blockProducts.toArray().catch(()=> [] as OfflineBlockProduct[]); if (cached.length > 0) setProducts(cached as unknown as Product[]); } catch {}
    try {
      const userId = await getUserIdLocal();
      const url = `/api/block-products?userId=${userId}&category=${cat}&search=${encodeURIComponent(search)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as ApiProductsResponse;
        const list = (data.products || data.data || []) as Product[];
        const mapped = list.map((p) => ({ ...p, localId: p.localId || p._id || `prod_${Date.now()}`, synced: 1, createdAt: p.createdAt || new Date().toISOString(), lastPurchaseDate: p.lastPurchaseDate || p.updatedAt || p.createdAt })) as Product[];
        setProducts(mapped);
        for (const pm of mapped) { await offlineDB.blockProducts.put(pm as unknown as OfflineBlockProduct); }
      }
    } catch {} finally { setIsLoading(false); }
  }, [cat, search]);
// eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  function applyPreset(category: BlockCategory, name: string, rairi: number, buy: number, sell: number) {
    setForm({ name, category, stock: String(rairi > 0 ? rairi : 100), buyPriceAvg: String(buy), sellPrice: String(sell), stockMode: "limited", rairiPerTrolley: String(rairi > 0 ? rairi : 60) });
  }

  async function handleSave(): Promise<void> {
    if (!form.name.trim()) { alert("نام لکھنا ضروری ہے"); return; }
    setSaving(true);
    async function getUserIdLocal(): Promise<string> {
      try { const res = await fetch("/api/auth/session"); if (res.ok) { const data = await res.json() as { user?: { id?: string; _id?: string } }; if (data?.user?.id) return data.user.id; if (data?.user?._id) return data.user._id; } } catch {}
      const offlineUser = getOfflineUser() as OfflineUser; return offlineUser?._id || offlineUser?.id || "offline_user";
    }
    const userId = await getUserIdLocal();
    const nowISO = new Date().toISOString();
    const localId = editing || `prod_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const existingSame = products.find((p) => p.name.toLowerCase() === form.name.trim().toLowerCase() && p.category === form.category);

    try {
      if (existingSame && !editing) {
        const addQty = toNum(form.stock);
        const newStock = rnd(existingSame.stock + addQty);
        const historyEntry: StockHistoryItem = { qty: addQty, date: nowISO, buyPrice: toNum(form.buyPriceAvg), sellPrice: toNum(form.sellPrice), rairi: toNum(form.rairiPerTrolley), trolleyPrice: toNum(form.buyPriceAvg) };
        const row: Product = { ...existingSame, stock: newStock, buyPrice: toNum(form.buyPriceAvg), buyPriceAvg: toNum(form.buyPriceAvg), sellPrice: toNum(form.sellPrice), rairiPerTrolley: toNum(form.rairiPerTrolley), lastPurchaseDate: nowISO, updatedAt: nowISO, synced: 0, stockHistory: [...(existingSame.stockHistory || []), historyEntry] };
        await offlineDB.blockProducts.put(row as unknown as OfflineBlockProduct);
        await offlineDB.syncQueue.put({ type: "product", localId: existingSame.localId, payload: row as unknown as SyncQueueItem["payload"], createdAt: new Date(), attempts: 0 });
        if (navigator.onLine) { 
          try { 
            await fetch("/api/block-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localId: existingSame.localId, name: row.name, category: row.category, stock: addQty, buyPrice: row.buyPrice, buyPriceAvg: row.buyPriceAvg, sellPrice: row.sellPrice, rairiPerTrolley: row.rairiPerTrolley, userId, lastPurchaseDate: nowISO }) }); 
          } catch {} 
        }
      } else {
        const base = editing ? products.find((p) => p.localId === editing) : null;
        const isEdit = !!editing;
        const row: Product = { _id: isEdit ? base?._id : undefined, localId, name: form.name.trim(), normalizedName: form.name.trim().toLowerCase(), category: form.category, stock: toNum(form.stock), buyPrice: toNum(form.buyPriceAvg), buyPriceAvg: toNum(form.buyPriceAvg), sellPrice: toNum(form.sellPrice), rairiPerTrolley: toNum(form.rairiPerTrolley), stockMode: form.stockMode, userId, synced: 0, createdAt: isEdit ? base?.createdAt || nowISO : nowISO, lastPurchaseDate: isEdit ? base?.lastPurchaseDate : nowISO, updatedAt: nowISO, stockHistory: isEdit ? base?.stockHistory : [{ qty: toNum(form.stock), date: nowISO, buyPrice: toNum(form.buyPriceAvg), sellPrice: toNum(form.sellPrice), rairi: toNum(form.rairiPerTrolley) }] };
        await offlineDB.blockProducts.put(row as unknown as OfflineBlockProduct);
        await offlineDB.syncQueue.put({ type: "product", localId, payload: row as unknown as SyncQueueItem["payload"], createdAt: new Date(), attempts: 0 });
        if (navigator.onLine) {
          try {
            if (isEdit && row._id) { await fetch(`/api/block-products/${row._id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: row.name, category: row.category, stock: row.stock, stockMode: row.stockMode, buyPrice: row.buyPrice, buyPriceAvg: row.buyPriceAvg, sellPrice: row.sellPrice, rairiPerTrolley: row.rairiPerTrolley }) }); }
            else { await fetch("/api/block-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...row, localId, userId }) }); }
          } catch {}
        }
      }
      setForm({ name: "", category: "crush", stock: "60", buyPriceAvg: "13000", sellPrice: "17000", stockMode: "limited", rairiPerTrolley: "60" });
      setEditing(null);
      await load();
    } catch (e) { console.error(e); alert("محفوظ کرنے میں ناکامی"); } finally { setSaving(false); }
  }

  async function handleDelete(id: string, dbId?: string): Promise<void> {
    if (!confirm(`کیا آپ حذف کرنا چاہتے ہیں؟`)) return;
    try { await offlineDB.blockProducts.delete(id); await offlineDB.syncQueue.where("localId").equals(id).delete(); if (dbId) await fetch(`/api/block-products/${dbId}`, { method: "DELETE" }); } catch {}
    await load();
  }

  function handleCategoryChange(value: string): void {
    const valid: BlockCategory[] = ["khaka","crush","bajri","rait","block","cement","brick","other"];
    if (valid.includes(value as BlockCategory)) setForm((prev) => ({ ...prev, category: value as BlockCategory }));
  }
  function handleStockModeChange(value: string): void {
    if (value === "limited" || value === "unlimited") setForm((prev) => ({ ...prev, stockMode: value as StockMode }));
  }

  const filtered = products.filter((p) => { if (cat !== "all" && p.category !== cat) return false; if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false; return true; });
  const perRairiLive = form.rairiPerTrolley && Number(form.rairiPerTrolley) > 0 ? Number((toNum(form.buyPriceAvg) / Number(form.rairiPerTrolley)).toFixed(2)) : 0;

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="p-2 sm:p-4 space-y-3 max-w-6xl mx-auto">
        <div className="flex justify-between items-center px-1">
          <h1 className="text-[13px] sm:text-[16px] font-bold">🧱 بلاک میٹریل - No Batch - ٹرالی 60 ریڑھی (10000-15000) / ٹرک 800 ریڑھی</h1>
        </div>

        <div className="bg-white border rounded-xl p-3 space-y-3">
          <p className="text-[11px] text-gray-500">بٹن دبائیں تو نام، قسم، ریڑھی خود بھر جائے گی - ٹرالی 60 ریڑھی, ٹرک 800 ریڑھی</p>
          {PRESET_GROUPS.map(group => (
            <div key={group.label}>
              <div className="text-[11px] font-bold text-gray-700 mb-1.5">{group.label}:</div>
              <div className="flex gap-1.5 flex-wrap">
                {group.items.map(m => (
                  <button key={m.name} onClick={() => applyPreset(group.category, m.name, m.rairi, m.buy, m.sell)} className={`px-3 py-1.5 rounded-full text-[11px] border font-bold ${form.name === m.name ? "bg-black text-white" : "bg-yellow-50 border-yellow-200 hover:bg-yellow-100"}`}>
                    {m.name} {m.rairi > 0 ? `(${m.rairi} ریڑھی - ${m.buy} Rs)` : ""}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 px-1">
          {categories.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border text-[10px] sm:text-[12px] capitalize shrink-0 ${cat === c ? "bg-black text-white font-bold" : "bg-white"}`}>
              {c==="all"?"سب":c==="block"?"بلاک":c==="crush"?"کرش":c==="khaka"?"خاکہ":c==="bajri"?"بجری":c==="rait"?"ریت":c==="brick"?"اینٹ / برک":c==="cement"?"سیمنٹ":"دیگر"}
            </button>
          ))}
        </div>

        <div className="flex gap-2 px-1">
          <div className="flex-1">
            <label className="text-[9px] sm:text-[11px] font-bold text-gray-700">پرڈکٹ تلاش کریں</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="پن کرش، ترکے کرش تلاش کریں..." className="w-full border p-2 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[13px] mt-1" />
          </div>
          <button onClick={() => void load()} className="border px-3 sm:px-4 py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-[12px] bg-white font-bold self-end h-9 sm:h-10.5">تلاش</button>
        </div>

        <div className="border rounded-lg sm:rounded-xl p-2.5 sm:p-3 space-y-3 bg-white mx-1 sm:mx-0">
          <h2 className="font-bold text-[11px] sm:text-[13px]">{editing ? `ترمیم - فی ریڑھی: ${perRairiLive} Rs` : `+ نیا میٹریل - فی ریڑھی: ${perRairiLive} Rs`}</h2>
          <div><label className="text-[9px] sm:text-[11px] font-bold text-gray-700">پرڈکٹ کا نام *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثلاً پن کرش" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1 font-bold" /></div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div><label className="text-[9px] sm:text-[11px] font-bold text-gray-700">قسم *</label><select value={form.category} onChange={(e) => handleCategoryChange(e.target.value)} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] capitalize mt-1"><option value="block">بلاک</option><option value="crush">کرش</option><option value="khaka">خاکہ</option><option value="bajri">بجری</option><option value="rait">ریت</option><option value="brick">اینٹ / برک</option><option value="cement">سیمنٹ</option><option value="other">دیگر</option></select></div>
            <div><label className="text-[9px] sm:text-[11px] font-bold text-gray-700">ریڑھی فی ٹرالی / ٹرک *</label><select value={form.rairiPerTrolley} onChange={(e) => setForm({ ...form, rairiPerTrolley: e.target.value })} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1 font-bold bg-blue-50"><option value="60">60 ریڑھی - ٹرالی</option><option value="55">55 ریڑھی - گھٹہ</option><option value="800">800 ریڑھی - بارز ٹرک</option><option value="100">100 ریڑھی - خاکہ</option><option value="1000">1000 عدد - اینٹ</option></select></div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div><label className="text-[9px] sm:text-[11px] font-bold text-gray-700">کل ریڑھی *</label><input type="text" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="60" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1 font-bold bg-blue-50" /></div>
            <div><label className="text-[9px] sm:text-[11px] font-bold text-gray-700">ٹرالی قیمت خرید</label><input type="text" inputMode="numeric" value={form.buyPriceAvg} onChange={(e) => setForm({ ...form, buyPriceAvg: e.target.value })} placeholder="13000" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] mt-1" /><span className="text-[9px] text-blue-600">فی ریڑھی {perRairiLive} Rs</span></div>
            <div><label className="text-[9px] sm:text-[11px] font-bold text-gray-700">ٹرالی قیمت فروخت</label><input type="text" inputMode="numeric" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} placeholder="17000" className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[13px] font-bold mt-1" /></div>
          </div>
          <button onClick={() => void handleSave()} disabled={saving} className="w-full bg-black text-white p-2.5 rounded-lg text-[11px] sm:text-[13px] font-bold disabled:bg-gray-300">{saving ? "محفوظ ہو رہا ہے..." : editing ? `اپڈیٹ کریں - ${form.name} (${form.rairiPerTrolley} ریڑھی @ ${perRairiLive} Rs)` : `محفوظ کریں - ${form.name || "نیا میٹریل"} - ${form.stock} ریڑھی @ ${perRairiLive} Rs فی ریڑھی`}</button>
          {editing && (<button onClick={() => { setEditing(null); setForm({ name: "", category: "crush", stock: "60", buyPriceAvg: "13000", sellPrice: "17000", stockMode: "limited", rairiPerTrolley: "60" }); }} className="w-full border py-2 rounded-lg text-[11px] sm:text-[13px]">ترمیم منسوخ کریں</button>)}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 px-1">{[1,2,3].map(i => (<div key={i} className="h-35 bg-white border rounded-xl animate-pulse p-3"><div className="h-3 bg-gray-200 rounded w-1/2 mb-3"></div><div className="h-2 bg-gray-100 rounded w-full mb-2"></div><div className="h-16 bg-gray-50 rounded"></div></div>))}</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 px-1">
            {filtered.map((p) => {
              const rates = getRates(p);
              const totalAdded = p.stockHistory?.reduce((s,h)=>s+h.qty,0) || 0;
              const totalSold = totalAdded > 0 ? Math.max(0, totalAdded - p.stock) : 0;
              const unit = getUnitLabel(p.category);
              return (
              <div key={p.localId} className="border rounded-xl p-2.5 sm:p-3 bg-white shadow-sm">
                <div className="flex justify-between gap-2">
                  <p className="font-bold text-[11px] sm:text-[13px] leading-tight flex-1 min-w-0 truncate">{p.name} <span className="text-[8px] sm:text-[10px] bg-gray-100 px-1.5 py-0.5 rounded uppercase ml-1">{p.category}</span> <span className="text-[8px]">{p.synced===0?"🟡":"🟢"}</span></p>
                  <div className="flex gap-1 shrink-0"><button onClick={() => { setForm({ name: p.name, category: p.category, stock: String(p.stock), buyPriceAvg: String(p.buyPriceAvg), sellPrice: String(p.sellPrice), stockMode: p.stockMode, rairiPerTrolley: String(p.rairiPerTrolley || 60) }); setEditing(p.localId); }} className="text-[9px] sm:text-[11px] border px-2 py-1 rounded-lg">ترمیم</button><button onClick={() => void handleDelete(p.localId, p._id)} className="text-[9px] sm:text-[11px] bg-red-50 text-red-600 px-2 py-1 rounded-lg">حذف</button></div>
                </div>
                <p className="text-[10px] sm:text-[11px] mt-1 text-gray-700">اسٹاک: {p.stock} {unit} | {rates.label} | فی ریڑھی خرید {rates.perRairiBuy} Rs | فروخت {rates.perRairiSell} Rs | کل مالیت خرید {rates.totalBuy.toLocaleString()} | فروخت {rates.totalSell.toLocaleString()} Rs ✅</p>
                <div className="mt-2 bg-gray-50 p-2 rounded-lg text-[9px] sm:text-[10px] space-y-1">
                  <div className="flex justify-between"><span>📅 پہلی اشاعت:</span><span className="font-bold">{fmtDate(p.createdAt)}</span></div>
                  <div className="flex justify-between"><span>🚚 آخری خریداری:</span><span className="font-bold">{fmtDate(p.lastPurchaseDate || p.updatedAt)}</span></div>
                  {p.stockHistory && p.stockHistory.length > 0 && (
                    <div className="border-t pt-2 mt-2">
                      <div className="flex justify-between items-center"><b className="text-[10px] sm:text-[11px]">📋 تمام اشاعت کی تاریخیں:</b><span className="text-[8px] bg-black text-white px-1.5 py-0.5 rounded">{p.stockHistory.length} اندراج</span></div>
                      <div className="max-h-27.5 sm:max-h-35 overflow-y-auto mt-1 space-y-1 pr-1">
                        {p.stockHistory.slice(0, 100).map((h, i) => (<div key={i} className="flex justify-between bg-white p-1.5 rounded border text-[10px] sm:text-[11px]"><span>• {h.qty} {unit} @ خرید {h.buyPrice} / فروخت {h.sellPrice} {h.rairi ? `(${h.rairi} ریڑھی)` : ""}</span><span className="font-bold text-[8px] sm:text-[9px] shrink-0 ml-2">{fmtDate(h.date)}</span></div>))}
                      </div>
                      <div className="font-bold text-[10px] sm:text-[11px] mt-2 bg-black text-white p-1.5 rounded text-center">شامل شدہ: {totalAdded} | فروخت شدہ: {totalSold} | موجودہ اسٹاک: {p.stock} {unit} ✅</div>
                    </div>
                  )}
                </div>
              </div>);
            })}
            {filtered.length === 0 && !isLoading && <div className="text-center text-[11px] text-gray-400 py-8 bg-white rounded-xl border">کوئی پراڈکٹ نہیں ملا - {cat} میں</div>}
          </div>
        )}
      </div>
    </div>
  );
}