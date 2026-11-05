"use client";
import { useEffect, useState, useMemo } from "react";
import { offlineDB } from "@/lib/offline-db";
import { saveBlockDailyOffline, deleteBlockDailyOffline, type BlockDailyInput } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";
import type { OfflineBlockDaily, BillEntry, MixMaterialEntry, OfflineTrolleyStock, OfflineBlockProduct } from "@/lib/offline-db";
import * as XLSX from "xlsx";

const API_TROLLEY = "/api/trolley-stock";

type BlockTypeOption = "4 inch" | "5 inch" | "6 inch" | "8 inch";
type OfflineUser = { _id?: string; id?: string } | null;
type FormState = { 
  date: string; 
  cementBags: number; 
  cementRate: number;
  blocksMade: string; 
  blocksCount: number; 
  blockType: BlockTypeOption; 
  ratePerBlock: number; 
  isMonthlyElectricity: boolean;
};
type BlockDailyDoc = {
  _id: string; localId?: string; date: string; cementBags: number; cementRate?: number; blocksMade: string; blocksCount: number;
  dailyWages: number; ratePerBlock: number; blockType: string; userId: string; createdAt: string;
  bills?: BillEntry[]; mixMaterials?: MixMaterialEntry[]; totalBill?: number; mixCost?: number; 
  costPerBlock?: number; isMonthlyElectricity?: boolean;
};
type ApiResponse = { data?: BlockDailyDoc[]; blockDailies?: BlockDailyDoc[]; };
type SessionResponse = { user?: { id?: string; _id?: string } };
type OfflineDailyWithRate = OfflineBlockDaily & { cementRate?: number; cementCost?: number };

const DEFAULT_BLOCKS = ["شگہ بلاک", "فل کرش بلاک", "مکس کرش بلاک", "ون کھتہ", "3 نمبر کھتہ", "کنکر کھتہ", "مکس کرش بلاک"];

function getPKDate(): string {
  const d = new Date(); d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 300);
  return d.toISOString().split("T")[0];
}
function rnd(n: number): number { return Math.round(Number(n) || 0); }
function isElectricLabel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("electric") || l.includes("bijli") || l.includes("بجلی") || l.includes("wapda");
}

export default function BlockDailyPage() {
  const [form, setForm] = useState<FormState>({
    date: getPKDate(), 
    cementBags: 17,
    cementRate: 1400, 
    blocksMade: "6 انچ بلاک", 
    blocksCount: 798, 
    blockType: "6 inch", 
    ratePerBlock: 3, 
    isMonthlyElectricity: false,
  });
  // ✅ FIX: مزدوری کی بجائے پیٹرول بل
  const [bills, setBills] = useState<BillEntry[]>([{ label: "پیٹرول بل", amount: 0 }, { label: "دوپہر کا کھانا", amount: 0 }]);
  const [newBillLabel, setNewBillLabel] = useState(""); const [newBillAmount, setNewBillAmount] = useState(0);
  const [mixMaterials, setMixMaterials] = useState<MixMaterialEntry[]>([]);
  const [newMixLabel, setNewMixLabel] = useState(""); 
  const [newMixRairi, setNewMixRairi] = useState(0);
  const [newMixRate, setNewMixRate] = useState(0);
  const [trolleyStocks, setTrolleyStocks] = useState<OfflineTrolleyStock[]>([]);
  const [saving, setSaving] = useState(false);
  const [blockOptions, setBlockOptions] = useState<string[]>(DEFAULT_BLOCKS);
  const [history, setHistory] = useState<OfflineDailyWithRate[]>([]);
  const [filter, setFilter] = useState(""); const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);

  const wages = useMemo(() => rnd(form.blocksCount * form.ratePerBlock), [form.blocksCount, form.ratePerBlock]);
  
  // ✅ FIX: ab auto mazdoor overwrite nahi — petrol bill user likhega
  const displayBills = useMemo(() => bills, [bills]);

  const { totalBill, mixCost, cementCost, petrolCost } = useMemo(() => {
    const extra = displayBills.reduce((s, b) => {
      if (form.isMonthlyElectricity && isElectricLabel(b.label)) return s;
      return s + (b.amount || 0);
    }, 0);
    const petrol = displayBills.find(b => b.label.includes("پیٹرول") || b.label.toLowerCase().includes("petrol"))?.amount || 0;
    const tMix = mixMaterials.reduce((s, m) => s + (m.amount || 0), 0);
    const cCost = rnd(form.cementBags * form.cementRate);
    return { 
      mixCost: tMix, 
      cementCost: cCost, 
      petrolCost: petrol,
      totalBill: wages + extra + tMix + cCost
    };
  }, [displayBills, mixMaterials, wages, form.isMonthlyElectricity, form.cementBags, form.cementRate]);

  async function getUserId(): Promise<string> {
    try { 
      const res = await fetch("/api/auth/session", { cache: "no-store" }); 
      if (res.ok) { 
        const data = (await res.json()) as SessionResponse; 
        if (data?.user?.id) return data.user.id; 
        if (data?.user?._id) return data.user._id; 
      } 
    } catch {}
    const offlineUser = getOfflineUser() as OfflineUser; 
    return offlineUser?._id || offlineUser?.id || "offline_user";
  }

  async function loadHistory(): Promise<void> {
    const offline = await offlineDB.blockDaily.toArray().catch((): OfflineDailyWithRate[] => []);
    setHistory(offline.sort((a,b)=> b.date.localeCompare(a.date)));
    try {
      const res = await fetch(`/api/block-daily`, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as ApiResponse;
        const data = j.data ?? j.blockDailies ?? [];
        if (data.length > 0) {
          const mapped: OfflineDailyWithRate[] = data.map((d) => ({
            localId: d.localId || d._id || `daily_${d._id}`,
            _id: d._id,
            date: new Date(d.date).toISOString().split("T")[0],
            cementBags: d.cementBags,
            cementRate: d.cementRate || 1400,
            cementCost: (d.cementBags || 0) * (d.cementRate || 1400),
            blocksMade: d.blocksMade,
            blocksCount: d.blocksCount,
            dailyWages: d.dailyWages,
            ratePerBlock: d.ratePerBlock,
            mazdoorRatePerBlock: d.ratePerBlock,
            labourCost: d.dailyWages,
            blockType: d.blockType,
            userId: d.userId,
            synced: 1,
            createdAt: d.createdAt,
            bills: d.bills || [],
            mixMaterials: d.mixMaterials || [],
            totalBill: d.totalBill || d.dailyWages,
            mixCost: d.mixCost || 0,
            trolleyMixCost: d.mixCost || 0,
            costPerBlock: d.costPerBlock || 0,
            isMonthlyElectricity: d.isMonthlyElectricity || false,
          } as OfflineDailyWithRate));
          setHistory(mapped.sort((a,b) => b.date.localeCompare(a.date)));
        }
      }
    } catch {}
  }

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const products = await offlineDB.blockProducts.toArray().catch((): OfflineBlockProduct[] => []);
        if (products.length > 0) {
          const map = new Map<string, string>();
          for (const p of products) { 
            const name = p.name.trim(); if (!name) continue; const key = name.toLowerCase(); if (!map.has(key)) map.set(key, name); 
          }
          const unique = Array.from(map.values()).sort((a, b) => a.localeCompare(b));
          if (unique.length > 0) setBlockOptions(unique);
        }
        const stocks = await offlineDB.trolleyStock.toArray().catch((): OfflineTrolleyStock[] => []);
        setTrolleyStocks(stocks);
        try {
          const userId = await getUserId();
          const res = await fetch(`${API_TROLLEY}?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
          if (res.ok) {
            const j = await res.json() as { stock?: OfflineTrolleyStock[] };
            if (j.stock && j.stock.length > 0) setTrolleyStocks(j.stock);
          }
        } catch {}
      } catch {}
      void loadHistory();
    }
    void load();
  }, []);

  const addBill = (): void => { if (!newBillLabel.trim()) return; setBills([...bills, { label: newBillLabel.trim(), amount: rnd(newBillAmount || 0) }]); setNewBillLabel(""); setNewBillAmount(0); };
  
  const updateBill = (idx: number, field: "label"|"amount", val: string|number): void => { 
    const copy = [...bills]; 
    const target = copy[idx];
    if (!target) return;
    if (field === "label") target.label = String(val);
    else target.amount = rnd(Number(val) || 0);
    setBills(copy); 
  };
  
  const removeBill = (idx: number): void => setBills(bills.filter((_, i) => i !== idx));

  const addMix = (): void => { 
    if (!newMixLabel.trim() || newMixRairi <= 0) return;
    const stock = trolleyStocks.find(s => s.normalizedMaterial === newMixLabel.toLowerCase().trim() || s.material === newMixLabel.trim());
    const rate = newMixRate > 0 ? newMixRate : stock ? Number(Number(stock.avgRate).toFixed(2)) : 0;
    const amount = rnd(newMixRairi * rate);
    const entry = { 
      label: newMixLabel.trim(), 
      qty: `${newMixRairi} ریڑھی`, 
      rairi: rnd(newMixRairi), 
      rate: rate, 
      amount, 
      trolleyEntryId: stock?.localId || "",
      batchId: "",
    } as unknown as MixMaterialEntry;
    setMixMaterials([...mixMaterials, entry]); 
    setNewMixLabel(""); setNewMixRairi(0); setNewMixRate(0); 
  };

  const updateMix = (idx: number, field: "label"|"rairi"|"rate", val: string|number): void => { 
    const copy = [...mixMaterials]; 
    const item = copy[idx];
    if (!item) return;
    if (field === "label") item.label = String(val);
    if (field === "rairi") { 
      item.rairi = rnd(Number(val)||0); 
      item.qty = `${item.rairi} ریڑھی`; 
      item.amount = rnd(item.rairi * item.rate); 
    }
    if (field === "rate") { 
      item.rate = Number(Number(val)||0); 
      item.amount = rnd(item.rairi * item.rate); 
    }
    setMixMaterials(copy); 
  };
  
  const removeMix = (idx: number): void => setMixMaterials(mixMaterials.filter((_, i) => i !== idx));

  async function handleSubmit(): Promise<void> {
    if (!form.blocksMade.trim() || form.blocksCount <= 0) { alert("نام اور تعداد چیک کریں"); return; }
    setSaving(true);
    try {
      const userId = await getUserId();
      const payload = { 
        date: form.date, 
        cementBags: form.cementBags, 
        cementRate: form.cementRate, 
        cementCost,
        blocksMade: form.blocksMade, 
        blocksCount: form.blocksCount, 
        blockType: form.blockType, 
        ratePerBlock: form.ratePerBlock, 
        isMonthlyElectricity: form.isMonthlyElectricity, 
        dailyWages: wages, 
        bills: bills.filter(b => b.label.trim()), 
        mixMaterials, 
        totalBill, mixCost, labourCost: wages, petrolCost,
        costPerBlock: form.blocksCount>0 ? Number((totalBill/form.blocksCount).toFixed(2)) : 0,
        userId 
      };
      if (editingId && editingLocalId) {
        try { await deleteBlockDailyOffline(editingLocalId); } catch { await offlineDB.blockDaily.delete(editingLocalId); }
        if (navigator.onLine) {
          try { await fetch(`/api/block-daily/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } catch {}
        }
        const newLocalId = await saveBlockDailyOffline({ ...payload, localId: editingLocalId } as BlockDailyInput);
        if (navigator.onLine) {
          try {
            const res = await fetch("/api/block-daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, localId: newLocalId }) });
            if (res.ok) await offlineDB.blockDaily.update(newLocalId, { synced: 1 });
          } catch {}
        }
        setEditingId(null); setEditingLocalId(null);
      } else {
        const localId = await saveBlockDailyOffline(payload as BlockDailyInput);
        if (navigator.onLine) { 
          try { 
            const res = await fetch("/api/block-daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, localId }) }); 
            if (res.ok) await offlineDB.blockDaily.update(localId, { synced: 1 }); 
          } catch {} 
        }
      }
      await loadHistory(); 
      const allStocks = await offlineDB.trolleyStock.toArray().catch((): OfflineTrolleyStock[] => []);
      setTrolleyStocks(allStocks);
      setForm((f) => ({ ...f, date: getPKDate(), blocksCount: 798 }));
      setBills([{ label: "پیٹرول بل", amount: 0 }, { label: "دوپہر کا کھانا", amount: 0 }]); 
      setMixMaterials([]);
    } finally { setSaving(false); }
  }

  function handleEdit(item: OfflineDailyWithRate): void {
    setForm({ 
      date: item.date, 
      cementBags: item.cementBags, 
      cementRate: item.cementRate || 1400,
      blocksMade: item.blocksMade, 
      blocksCount: item.blocksCount, 
      blockType: item.blockType as BlockTypeOption, 
      ratePerBlock: item.ratePerBlock, 
      isMonthlyElectricity: item.isMonthlyElectricity || false 
    });
    // ✅ edit pe agar purana mazdoor bill hai to petrol me convert
    const oldBills = item.bills && item.bills.length > 0 ? item.bills : [{ label: "پیٹرول بل", amount: 0 }];
    const fixedBills = oldBills.map(b => b.label.includes("مزدوری") ? { ...b, label: "پیٹرول بل", amount: 0 } : b);
    setBills(fixedBills.length>0 ? fixedBills : [{ label: "پیٹرول بل", amount: 0 }, { label: "دوپہر کا کھانا", amount: 0 }]); 
    setMixMaterials(item.mixMaterials || []);
    setEditingId(item._id || item.localId); setEditingLocalId(item.localId); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(item: OfflineDailyWithRate): Promise<void> {
    if (!confirm(`حذف کریں ${item.blocksMade} - ${item.blocksCount} نغ؟`)) return;
    try { await deleteBlockDailyOffline(item.localId); } catch { await offlineDB.blockDaily.delete(item.localId); }
    if (navigator.onLine && item._id) {
      try {
        const userId = await getUserId();
        await fetch(`/api/block-daily/${item._id}?userId=${userId}`, { method: "DELETE" });
      } catch {}
    }
    setHistory((h) => h.filter((x) => x.localId !== item.localId));
  }

  function exportExcel(): void {
    const rows = history.filter((h) => !filter || h.blocksMade.toLowerCase().includes(filter.toLowerCase()));
    if (rows.length === 0) { alert("کوئی ڈیٹا نہیں"); return; }
    const allMixLabels = Array.from(new Set(rows.flatMap(r => (r.mixMaterials || []).map(m => m.label.trim()).filter(Boolean)))).sort();
    const headerMain = [`منصور بلاک فیکٹری - روزانہ پیداوار رپورٹ`];
    const headerSummary = [`تاریخ: ${getPKDate()} | ریکارڈ: ${rows.length} | بلاکس: ${rows.reduce((s,r)=>s+r.blocksCount,0)} | بوری: ${rows.reduce((s,r)=>s+r.cementBags,0)} | کل بل: ${rows.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0)} روپے`];
    const tableHeader = ["تاریخ","بلاک نام","سائز","تعداد (نغ)","بوری","ریٹ","مزدوری","پیٹرول بل","کھانا بل","دیگر بل",...allMixLabels.map(l => `مکس: ${l} ریڑھی`),...allMixLabels.map(l => `مکس: ${l} روپے`),"تمام مکس تفصیل","کل بل","مکس خرچ","فی بلاک خرچ","بجلی ماہانہ؟","حالت"];
    const sheetData: (string | number)[][] = [
      headerMain, headerSummary, [], tableHeader,
      ...rows.map((r) => {
        const getBill = (name: string): number => r.bills?.find(b => b.label.includes(name) || b.label.toLowerCase().includes(name.toLowerCase()))?.amount || 0;
        const other = (r.bills||[]).filter(b => !b.label.includes("پیٹرول") && !b.label.includes("کھانا") && !b.label.includes("مزدوری") && !isElectricLabel(b.label)).map(b=>`${b.label}: ${b.amount} روپے`).join(" | ");
        const mixMapRairi = new Map((r.mixMaterials||[]).map(m => [m.label.trim(), m.rairi])); 
        const mixMapRs = new Map((r.mixMaterials||[]).map(m => [m.label.trim(), m.amount]));
        const mixColsRairi = allMixLabels.map(lbl => mixMapRairi.get(lbl) || "");
        const mixColsRs = allMixLabels.map(lbl => mixMapRs.get(lbl) || "");
        const allMix = (r.mixMaterials||[]).map(m=>`${m.label}:${m.rairi} ریڑھی x ${m.rate} روپے = ${m.amount} روپے`).join(" | ");
        return [r.date, r.blocksMade, r.blockType, r.blocksCount, r.cementBags, r.ratePerBlock, r.dailyWages, getBill("پیٹرول") || getBill("پٹرول") || 0, getBill("کھانا"), other || "-", ...mixColsRairi, ...mixColsRs, allMix || "-", r.totalBill||r.dailyWages, r.mixCost||0, r.costPerBlock ? Number(r.costPerBlock).toFixed(2) : Number(((r.totalBill||r.dailyWages||0)/(r.blocksCount||1)).toFixed(2)), r.isMonthlyElectricity ? "ہاں" : "نہیں", r.synced===1 ? "ہم آہنگ" : "زیر التواء"] as (string | number)[];
      }),
      [], ["خلاصہ"], ["کل بلاکس", rows.reduce((s,r)=>s+r.blocksCount,0)], ["کل بوری", rows.reduce((s,r)=>s+r.cementBags,0)], ["کل مکس خرچ", rows.reduce((s,r)=>s+(r.mixCost||0),0)], ["کل بل", rows.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `روزانہ`);
    XLSX.writeFile(wb, `منصور_${getPKDate()}_${rows.reduce((s,r)=>s+r.blocksCount,0)}بلاکس.xlsx`);
  }

  const filtered = history.filter((h) => !filter || h.blocksMade.toLowerCase().includes(filter.toLowerCase()));
  const grandTotal = filtered.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0);
  const grandMix = filtered.reduce((s,r)=>s+(r.mixCost||0),0);
  const totalBlocks = filtered.reduce((s,r)=>s+r.blocksCount,0);

  return (
    <div className="min-h-screen bg-gray-50 py-1 sm:py-3" dir="rtl">
      <div className="max-w-[1024px] mx-auto px-1.5 sm:px-3 space-y-2 sm:space-y-3">
        <div className="bg-white border rounded-xl sm:rounded-2xl p-2 sm:p-4 shadow-sm">
          <h1 className="font-bold text-[12px] sm:text-[15px] mb-2">🧱 روزانہ پیداوار - No Batch - ٹرالی 60 ریڑھی {editingId && <span className="text-orange-600 text-[9px]">(ترمیم)</span>}</h1>
          <div className="space-y-2 sm:space-y-3">
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">تاریخ</label><input type="date" value={form.date} onChange={(e)=>setForm({...form,date:e.target.value})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5" /></div>
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">سائز</label><select value={form.blockType} onChange={(e)=>setForm({...form,blockType:e.target.value as BlockTypeOption})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5 bg-white"><option>4 inch</option><option>5 inch</option><option>6 inch</option><option>8 inch</option></select></div>
            </div>
            <div>
              <label className="text-[9px] sm:text-[10px] font-bold text-gray-600">بلاک کا نام</label>
              <select value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5 bg-white">{blockOptions.map((name, idx) => (<option key={`${name}-${idx}`} value={name}>{name}</option>))}</select>
              <input type="text" placeholder="یا نیا نام لکھیں" value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-1.5" />
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">سیمنٹ بوری</label><input type="number" value={form.cementBags} onChange={(e)=>setForm({...form,cementBags:Number(e.target.value)})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5" /></div>
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">بوری ریٹ</label><input type="number" value={form.cementRate} onChange={(e)=>setForm({...form,cementRate:Number(e.target.value)})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5" /></div>
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">فی بلاک مزدوری</label><input type="number" value={form.ratePerBlock} onChange={(e)=>setForm({...form,ratePerBlock:Number(e.target.value)})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5 bg-blue-50 font-bold" /></div>
            </div>
            <div className="border-t pt-2">
              <label className="font-bold text-[10px] sm:text-[11px]">بل / خرچہ - پیٹرول بل</label>
              {displayBills.map((b, idx) => (
                <div key={idx} className="flex gap-1 mt-1.5">
                  <input value={b.label} onChange={e=>updateBill(idx, "label", e.target.value)} placeholder="لیبل" className="flex-1 border p-1.5 sm:p-2 rounded-lg sm:rounded-xl text-[10px] sm:text-[11px]" />
                  <input type="number" value={b.amount} onChange={e=>updateBill(idx, "amount", e.target.value)} placeholder="روپے" className="w-[70px] sm:w-[85px] border p-1.5 sm:p-2 rounded-lg sm:rounded-xl text-[10px] sm:text-[11px] font-bold" />
                  <button onClick={()=>removeBill(idx)} className="px-2 bg-red-50 text-red-600 border border-red-200 rounded-lg sm:rounded-xl text-[10px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1 mt-1.5 bg-gray-50 p-1.5 rounded-lg sm:rounded-xl border border-dashed">
                <input value={newBillLabel} onChange={e=>setNewBillLabel(e.target.value)} placeholder="نیا لیبل (مثلا ڈیزل)" className="flex-1 border p-1.5 rounded-lg text-[10px] bg-white" />
                <input type="number" value={newBillAmount} onChange={e=>setNewBillAmount(Number(e.target.value))} placeholder="روپے" className="w-[60px] border p-1.5 rounded-lg text-[10px] bg-white" />
                <button onClick={addBill} className="px-2.5 bg-black text-white rounded-lg font-bold text-[10px]">+ شامل</button>
              </div>
            </div>
            <div className="border-t pt-2">
              <label className="font-bold text-[10px] sm:text-[11px]">مکس میٹریل - {mixCost} روپے (ریڑھی حساب)</label>
              {mixMaterials.map((m, idx) => (
                <div key={idx} className="flex gap-1 mt-1.5">
                  <input value={m.label} onChange={e=>updateMix(idx, "label", e.target.value)} placeholder="میٹریل" className="flex-1 border p-1.5 rounded-lg text-[10px] sm:text-[11px]" />
                  <input type="number" value={m.rairi} onChange={e=>updateMix(idx, "rairi", e.target.value)} placeholder="ریڑھی" className="w-[50px] border p-1.5 rounded-lg text-[10px]" />
                  <input type="number" value={m.rate} onChange={e=>updateMix(idx, "rate", e.target.value)} placeholder="ریٹ" className="w-[60px] border p-1.5 rounded-lg text-[10px]" />
                  <span className="w-[60px] bg-gray-100 border p-1.5 rounded-lg text-[10px] text-center font-bold">{m.amount} روپے</span>
                  <button onClick={()=>removeMix(idx)} className="px-2 bg-red-50 text-red-600 border rounded-lg text-[10px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1 mt-1.5 bg-blue-50 p-1.5 rounded-lg border border-dashed border-blue-200">
                <select value={newMixLabel} onChange={e=>{
                  const val = e.target.value;
                  setNewMixLabel(val);
                  const stock = trolleyStocks.find(s => s.material === val || s.normalizedMaterial === val.toLowerCase());
                  if (stock) setNewMixRate(Number(Number(stock.avgRate).toFixed(2)));
                }} className="flex-1 border p-1.5 rounded-lg text-[10px] bg-white">
                  <option value="">میٹریل منتخب کریں</option>
                  {trolleyStocks.map(s => <option key={s.localId} value={s.material}>{s.material} ({s.totalRairi} ریڑھی @ {Number(s.avgRate).toFixed(2)} روپے)</option>)}
                </select>
                <input type="number" value={newMixRairi || ""} onChange={e=>setNewMixRairi(Number(e.target.value))} placeholder="ریڑھی" className="w-[50px] border p-1.5 rounded-lg text-[10px] bg-white" />
                <input type="number" value={newMixRate || ""} onChange={e=>setNewMixRate(Number(e.target.value))} placeholder="ریٹ" className="w-[60px] border p-1.5 rounded-lg text-[10px] bg-white" />
                <button onClick={addMix} className="px-2.5 bg-[#0f4fb8] text-white rounded-lg font-bold text-[10px]">+ شامل</button>
              </div>
            </div>
            <div>
              <label className="text-[9px] sm:text-[10px] font-bold text-gray-600">تعداد</label>
              <div className="flex gap-1.5 mt-0.5"><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:Math.max(0,f.blocksCount-1)}))} className="px-3 py-1.5 border rounded-lg font-bold bg-gray-100 text-[11px]">-1</button><input type="number" value={form.blocksCount} onChange={(e)=>setForm({...form,blocksCount:Number(e.target.value)})} className="flex-1 border p-1.5 rounded-lg text-center font-bold text-[12px] sm:text-[13px]" /><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:f.blocksCount+1}))} className="px-3 py-1.5 border rounded-lg font-bold bg-gray-100 text-[11px]">+1</button></div>
            </div>
            <div className="bg-[#0f4fb8]/10 p-2 rounded-lg border text-[10px] sm:text-[11px] font-bold leading-6">
              مزدوری: {form.blocksCount} x {form.ratePerBlock} = {wages} روپے | سیمنٹ: {form.cementBags} x {form.cementRate} = {cementCost} روپے | پیٹرول: {petrolCost} روپے | مکس: {mixCost} روپے | کل بل: {totalBill} روپے
            </div>
            <button onClick={()=>void handleSubmit()} disabled={saving} className="w-full bg-black text-white p-2.5 sm:p-3 rounded-xl font-bold text-[11px] sm:text-[12px]">{saving ? "محفوظ ہو رہا ہے..." : editingId ? `اپڈیٹ کریں` : `${form.blocksCount} بلاک محفوظ کریں`}</button>
            {editingId && <button onClick={()=>{ setEditingId(null); setEditingLocalId(null); setForm((f)=>({...f, date: getPKDate(), blocksCount:798})); setBills([{label:"پیٹرول بل", amount:0},{label:"دوپہر کا کھانا", amount:0}]); setMixMaterials([]); }} className="w-full border p-2 rounded-xl text-[10px] font-bold">منسوخ کریں</button>}
          </div>
        </div>

        <div className="bg-white border rounded-xl sm:rounded-2xl p-1.5 sm:p-3 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 mb-2">
            <h2 className="font-bold text-[10px] sm:text-[12px] flex-1">📋 {filtered.length} ریکارڈ | {totalBlocks} نغ | {grandTotal} روپے | مکس {grandMix} روپے</h2>
            <button onClick={exportExcel} className="px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-[9px] sm:text-[11px] font-bold self-start sm:self-auto">⬇️ ایکسل</button>
          </div>
          <input placeholder="تلاش کریں..." value={filter} onChange={(e)=>setFilter(e.target.value)} className="w-full border p-1.5 sm:p-2 rounded-lg text-[10px] sm:text-[11px] mb-2"/>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[9px] sm:text-[10px]">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-right">تاریخ</th>
                  <th className="p-2 text-right">نام</th>
                  <th className="p-2">تعداد</th>
                  <th className="p-2">مکس خرچ</th>
                  <th className="p-2 min-w-[220px] text-right">تفصیل</th>
                  <th className="p-2">کل</th>
                  <th className="p-2">فی بلاک</th>
                  <th className="p-2">عمل</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r)=>(
                  <tr key={r.localId} className="border-t align-top">
                    <td className="p-1.5">{r.date}</td>
                    <td className="p-1.5 font-bold">{r.blocksMade}</td>
                    <td className="p-1.5 text-center font-bold">{r.blocksCount}</td>
                    <td className="p-1.5 text-center font-bold text-blue-600">{r.mixCost||0}</td>
                    <td className="p-1.5 text-[8px] max-w-[260px]">
                      <div className="flex flex-col gap-1">
                        {(r.mixMaterials||[]).map((m, i) => (
                          <div key={`${r.localId}-${i}`} className="leading-[11px] bg-gray-50 border border-dashed rounded px-1.5 py-1">
                            <div className="font-bold text-[9px]">{m.label}</div>
                            <div>{m.rairi} ریڑھی x {m.rate} = <b className="text-blue-600">{m.amount} روپے</b></div>
                          </div>
                        ))}
                        {(!r.mixMaterials || r.mixMaterials.length===0) && <span className="text-gray-400">-</span>}
                      </div>
                    </td>
                    <td className="p-1.5 font-bold">{r.totalBill||r.dailyWages}</td>
                    <td className="p-1.5 font-bold">{r.costPerBlock ? Number(r.costPerBlock).toFixed(2) : "0"}</td>
                    <td className="p-1.5">
                      <div className="flex gap-1">
                        <button onClick={()=>handleEdit(r)} className="px-2 py-1 bg-blue-600 text-white rounded text-[8px]">ترمیم</button>
                        <button onClick={()=>void handleDelete(r)} className="px-2 py-1 bg-red-600 text-white rounded text-[8px]">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}