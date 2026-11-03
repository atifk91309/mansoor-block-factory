"use client";
import { useEffect, useState, useMemo } from "react";
import { offlineDB } from "@/lib/offline-db";
import { saveBlockDailyOffline, BlockDailyInput } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";
import type { OfflineBlockDaily, BillEntry, MixMaterialEntry, OfflineTrolleyStock } from "@/lib/offline-db";
import * as XLSX from "xlsx";

type BlockTypeOption = "4 inch" | "5 inch" | "6 inch" | "8 inch";
type OfflineUser = { _id?: string; id?: string } | null;
type FormState = { 
  date: string; cementBags: number; blocksMade: string; blocksCount: number; 
  blockType: BlockTypeOption; ratePerBlock: number; isMonthlyElectricity: boolean;
};
type BlockDailyDoc = {
  _id: string; localId?: string; date: string; cementBags: number; blocksMade: string; blocksCount: number;
  dailyWages: number; ratePerBlock: number; blockType: string; userId: string; createdAt: string;
  bills?: BillEntry[]; mixMaterials?: MixMaterialEntry[]; totalBill?: number; mixCost?: number; 
  costPerBlock?: number; isMonthlyElectricity?: boolean;
};
type ApiResponse = { data?: BlockDailyDoc[]; blockDailies?: BlockDailyDoc[]; };

const DEFAULT_BLOCKS = ["Shaga Block", "Full crush Block", "Mix Crush Block", "One khahta", "3Number Khahta", "Concar Khahta", "mix crush Block"];

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
    date: getPKDate(), cementBags: 8, blocksMade: "6 inch Block", blocksCount: 798, 
    blockType: "6 inch", ratePerBlock: 3, isMonthlyElectricity: false,
  });
  const [bills, setBills] = useState<BillEntry[]>([{ label: "Labour Bill", amount: 0 }, { label: "Lunch Bill", amount: 0 }]);
  const [newBillLabel, setNewBillLabel] = useState(""); const [newBillAmount, setNewBillAmount] = useState(0);
  const [mixMaterials, setMixMaterials] = useState<MixMaterialEntry[]>([]);
  const [newMixLabel, setNewMixLabel] = useState(""); 
  const [newMixRairi, setNewMixRairi] = useState(0);
  const [newMixRate, setNewMixRate] = useState(0);
  const [trolleyStocks, setTrolleyStocks] = useState<OfflineTrolleyStock[]>([]);
  const [saving, setSaving] = useState(false);
  const [blockOptions, setBlockOptions] = useState<string[]>(DEFAULT_BLOCKS);
  const [history, setHistory] = useState<OfflineBlockDaily[]>([]);
  const [filter, setFilter] = useState(""); const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);

  const wages = useMemo(() => rnd(form.blocksCount * form.ratePerBlock), [form.blocksCount, form.ratePerBlock]);
  
  const displayBills = useMemo(() => {
    return bills.map(b => b.label.toLowerCase().includes("labour") ? { ...b, amount: wages } : b);
  }, [bills, wages]);

  const { totalBill, mixCost } = useMemo(() => {
    const extra = displayBills.reduce((s, b) => {
      if (b.label.toLowerCase().includes("labour")) return s;
      if (form.isMonthlyElectricity && isElectricLabel(b.label)) return s;
      return s + (b.amount || 0);
    }, 0);
    const mCost = mixMaterials.reduce((s, m) => s + (m.amount || 0), 0);
    return { mixCost: mCost, totalBill: wages + extra + mCost };
  }, [displayBills, mixMaterials, wages, form.isMonthlyElectricity]);

  async function loadHistory(): Promise<void> {
    const offline = await offlineDB.blockDaily.orderBy("date").reverse().toArray().catch(() => offlineDB.blockDaily.toArray().then(a => a.reverse()));
    setHistory(offline);
    try {
      const res = await fetch("/api/block-daily");
      if (res.ok) {
        const j = (await res.json()) as ApiResponse;
        const data = j.data ?? j.blockDailies ?? [];
        if (data.length > 0) {
          const mapped: OfflineBlockDaily[] = data.map((d: BlockDailyDoc) => ({
            localId: d.localId || d._id || `daily_${d._id}`, _id: d._id, date: new Date(d.date).toISOString().split("T")[0],
            cementBags: d.cementBags, blocksMade: d.blocksMade, blocksCount: d.blocksCount, dailyWages: d.dailyWages,
            ratePerBlock: d.ratePerBlock, blockType: d.blockType, userId: d.userId, synced: 1, createdAt: d.createdAt,
            bills: d.bills || [], mixMaterials: d.mixMaterials || [], totalBill: d.totalBill || d.dailyWages,
            mixCost: d.mixCost || 0, costPerBlock: d.costPerBlock || 0, isMonthlyElectricity: d.isMonthlyElectricity || false,
          }));
          setHistory(mapped.sort((a,b) => b.date.localeCompare(a.date)));
        }
      }
    } catch {}
  }

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const products = await offlineDB.blockProducts.where("category").equals("block").toArray();
        if (products.length > 0) {
          const map = new Map<string, string>();
          for (const p of products) { const name = p.name.trim(); if (!name) continue; const key = name.toLowerCase(); if (!map.has(key)) map.set(key, name); }
          const unique = Array.from(map.values()).sort((a, b) => a.localeCompare(b));
          if (unique.length > 0) setBlockOptions(unique);
        }
        const stocks = await offlineDB.trolleyStock.toArray();
        setTrolleyStocks(stocks);
        try {
          const res = await fetch("/api/trolley-stock");
          if (res.ok) {
            const j = await res.json() as { stock?: OfflineTrolleyStock[] };
            if (j.stock && j.stock.length > 0) setTrolleyStocks(j.stock as OfflineTrolleyStock[]);
          }
        } catch {}
      } catch {}
      void loadHistory();
    }
    void load();
  }, []);

  async function getUserId(): Promise<string> {
    try { const res = await fetch("/api/auth/session"); if (res.ok) { const data = (await res.json()) as { user?: { id?: string; _id?: string } }; if (data?.user?.id) return data.user.id; if (data?.user?._id) return data.user._id; } } catch {}
    const offlineUser = getOfflineUser() as OfflineUser; return offlineUser?._id || offlineUser?.id || "offline_user";
  }

  const addBill = (): void => { if (!newBillLabel.trim()) return; setBills([...displayBills, { label: newBillLabel.trim(), amount: rnd(newBillAmount || 0) }]); setNewBillLabel(""); setNewBillAmount(0); };
  const updateBill = (idx: number, field: "label"|"amount", val: string|number): void => { const copy = [...displayBills]; if (field === "label") copy[idx].label = val as string; else copy[idx].amount = rnd(Number(val) || 0); setBills(copy); };
  const removeBill = (idx: number): void => setBills(displayBills.filter((_, i) => i !== idx));

  const addMix = (): void => { 
    if (!newMixLabel.trim() || newMixRairi <= 0) return;
    const rate = newMixRate > 0 ? newMixRate : trolleyStocks.find(s => s.normalizedMaterial === newMixLabel.toLowerCase().trim())?.avgRate || 0;
    const amount = rnd(newMixRairi * rate);
    const stockEntry = trolleyStocks.find(s => s.normalizedMaterial === newMixLabel.toLowerCase().trim());
    setMixMaterials([...mixMaterials, { label: newMixLabel.trim(), qty: `${newMixRairi} Rairi`, rairi: rnd(newMixRairi), rate: rate, amount, trolleyEntryId: stockEntry?.localId || "" }]); 
    setNewMixLabel(""); setNewMixRairi(0); setNewMixRate(0); 
  };
  const updateMix = (idx: number, field: "label"|"rairi"|"rate", val: string|number): void => { 
    const copy = [...mixMaterials]; 
    if (field === "label") copy[idx].label = val as string;
    if (field === "rairi") { copy[idx].rairi = rnd(Number(val)||0); copy[idx].qty = `${copy[idx].rairi} Rairi`; copy[idx].amount = rnd(copy[idx].rairi * copy[idx].rate); }
    if (field === "rate") { copy[idx].rate = rnd(Number(val)||0); copy[idx].amount = rnd(copy[idx].rairi * copy[idx].rate); }
    setMixMaterials(copy); 
  };
  const removeMix = (idx: number): void => setMixMaterials(mixMaterials.filter((_, i) => i !== idx));

  async function handleSubmit(): Promise<void> {
    if (!form.blocksMade.trim() || form.blocksCount <= 0) { alert("Check name & count"); return; }
    setSaving(true);
    try {
      const userId = await getUserId();
      const payload: BlockDailyInput = { 
        date: form.date, cementBags: form.cementBags, blocksMade: form.blocksMade, blocksCount: form.blocksCount, 
        blockType: form.blockType, ratePerBlock: form.ratePerBlock, isMonthlyElectricity: form.isMonthlyElectricity, 
        dailyWages: wages, bills: displayBills.filter(b => b.label.trim()), mixMaterials: mixMaterials.filter(m => m.label.trim()), 
        totalBill, mixCost, userId 
      };
      if (editingId && editingLocalId) {
        if (navigator.onLine) { await fetch(`/api/block-daily/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
        await offlineDB.blockDaily.update(editingLocalId, { date: form.date, cementBags: rnd(form.cementBags), blocksMade: form.blocksMade, blocksCount: rnd(form.blocksCount), blockType: form.blockType, ratePerBlock: rnd(form.ratePerBlock), dailyWages: wages, bills: displayBills, mixMaterials, totalBill, mixCost, costPerBlock: form.blocksCount > 0 ? Math.round((totalBill/form.blocksCount)*100)/100 : 0, isMonthlyElectricity: form.isMonthlyElectricity, synced: navigator.onLine ? 1 : 0 });
        setEditingId(null); setEditingLocalId(null);
      } else {
        const localId = await saveBlockDailyOffline(payload);
        if (navigator.onLine) { try { const res = await fetch("/api/block-daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, localId }) }); if (res.ok) await offlineDB.blockDaily.update(localId, { synced: 1 }); } catch {} }
      }
      await loadHistory(); setForm((f) => ({ ...f, date: getPKDate(), blocksCount: 798 }));
      setBills([{ label: "Labour Bill", amount: wages }, { label: "Lunch Bill", amount: 0 }]); setMixMaterials([]);
    } finally { setSaving(false); }
  }

  function handleEdit(item: OfflineBlockDaily): void {
    setForm({ date: item.date, cementBags: item.cementBags, blocksMade: item.blocksMade, blocksCount: item.blocksCount, blockType: item.blockType as BlockTypeOption, ratePerBlock: item.ratePerBlock, isMonthlyElectricity: item.isMonthlyElectricity || false });
    setBills(item.bills && item.bills.length > 0 ? item.bills : [{ label: "Labour Bill", amount: item.dailyWages }]); 
    setMixMaterials(item.mixMaterials || []);
    setEditingId(item._id || item.localId); setEditingLocalId(item.localId); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function handleDelete(item: OfflineBlockDaily): Promise<void> {
    if (!confirm(`Delete ${item.blocksMade} - ${item.blocksCount}?`)) return;
    await offlineDB.blockDaily.delete(item.localId);
    if (navigator.onLine && item._id) { try { await fetch(`/api/block-daily/${item._id}`, { method: "DELETE" }); } catch {} }
    setHistory((h) => h.filter((x) => x.localId !== item.localId));
  }

  function exportExcel(): void {
    const rows = history.filter((h) => !filter || h.blocksMade.toLowerCase().includes(filter.toLowerCase()));
    if (rows.length === 0) { alert("No data"); return; }
    const allMixLabels = Array.from(new Set(rows.flatMap(r => (r.mixMaterials || []).map(m => m.label.trim()).filter(Boolean)))).sort();
    const headerMain = ["MOHAL - منصور بلاک فیکٹری - Daily Production Report"];
    const headerSummary = [`Date: ${getPKDate()} | Records: ${rows.length} | Blocks: ${rows.reduce((s,r)=>s+r.blocksCount,0)} | Bori: ${rows.reduce((s,r)=>s+r.cementBags,0)} | Grand: ${rows.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0)} Rs | MixCost: ${rows.reduce((s,r)=>s+(r.mixCost||0),0)} Rs`];
    const tableHeader = ["Date / تاریخ","Block Name / بلاک نام","Size / سائز","Count / تعداد (نغ)","Bags / بوری","Rate / ریٹ","Wages / مزدوری","Labour Bill","Lunch Bill","Other Bills / دیگر بل",...allMixLabels.map(l => `Mix: ${l} Rairi`),...allMixLabels.map(l => `Mix: ${l} Rs`),"All Mix Detail / تمام مکس","Total Bill / کل بل","Mix Cost","Cost Per Block / فی بلاک خرچ","Electric Monthly? / بجلی","Status"];
    const sheetData: (string | number)[][] = [
      headerMain, headerSummary, [], tableHeader,
      ...rows.map((r) => {
        const getBill = (name: string): number => r.bills?.find(b => b.label.toLowerCase().includes(name))?.amount || 0;
        const other = (r.bills||[]).filter(b => !b.label.toLowerCase().includes("labour") && !b.label.toLowerCase().includes("lunch") && !isElectricLabel(b.label)).map(b=>`${b.label}: ${b.amount} Rs`).join(" | ");
        const mixMapRairi = new Map((r.mixMaterials||[]).map(m => [m.label.trim(), m.rairi])); 
        const mixMapRs = new Map((r.mixMaterials||[]).map(m => [m.label.trim(), m.amount]));
        const mixColsRairi = allMixLabels.map(lbl => mixMapRairi.get(lbl) || "");
        const mixColsRs = allMixLabels.map(lbl => mixMapRs.get(lbl) || "");
        const allMix = (r.mixMaterials||[]).map(m=>`${m.label}:${m.rairi}R x ${m.rate}Rs = ${m.amount}Rs`).join(" | ");
        return [r.date, r.blocksMade, r.blockType, r.blocksCount, r.cementBags, r.ratePerBlock, r.dailyWages, getBill("labour") || r.dailyWages, getBill("lunch"), other || "-", ...mixColsRairi, ...mixColsRs, allMix || "-", r.totalBill||r.dailyWages, r.mixCost||0, r.costPerBlock ? Number(r.costPerBlock).toFixed(2) : Number(((r.totalBill||r.dailyWages||0)/(r.blocksCount||1)).toFixed(2)), r.isMonthlyElectricity ? "Yes" : "No", r.synced===1 ? "Synced" : "Pending"] as (string | number)[];
      }),
      [], ["Summary / خلاصہ"], ["کل بلاکس", rows.reduce((s,r)=>s+r.blocksCount,0)], ["کل بوری", rows.reduce((s,r)=>s+r.cementBags,0)], ["کل مکس خرچ", rows.reduce((s,r)=>s+(r.mixCost||0),0)], ["کل بل", rows.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws["!cols"] = [{ wch: 14 },{ wch: 24 },{ wch: 10 },{ wch: 12 },{ wch: 10 },{ wch: 8 },{ wch: 12 },{ wch: 14 },{ wch: 14 },{ wch: 32 },...allMixLabels.map(()=>({ wch: 12 })),...allMixLabels.map(()=>({ wch: 12 })),{ wch: 42 },{ wch: 14 },{ wch: 10 },{ wch: 14 },{ wch: 18 },{ wch: 12 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: tableHeader.length - 1 } },{ s: { r: 1, c: 0 }, e: { r: 1, c: tableHeader.length - 1 } }];
    ws["!autofilter"] = { ref: `A4:${XLSX.utils.encode_col(tableHeader.length - 1)}4` };
    ws["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", state: "frozen" };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `MOHAL Daily ${getPKDate()}`);
    XLSX.writeFile(wb, `MOHAL_Full_${getPKDate()}_${rows.reduce((s,r)=>s+r.blocksCount,0)}Blocks.xlsx`);
  }

  const filtered = history.filter((h) => !filter || h.blocksMade.toLowerCase().includes(filter.toLowerCase()));
  const grandTotal = filtered.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0);
  const grandMix = filtered.reduce((s,r)=>s+(r.mixCost||0),0);
  const totalBlocks = filtered.reduce((s,r)=>s+r.blocksCount,0);

  return (
    <div className="min-h-screen bg-gray-50 py-1 sm:py-3">
      <div className="max-w-[1024px] mx-auto px-1.5 sm:px-3 space-y-2 sm:space-y-3">
        <div className="bg-white border rounded-xl sm:rounded-2xl p-2 sm:p-4 shadow-sm">
          <h1 className="font-bold text-[12px] sm:text-[15px] mb-2 sm:mb-3">🧱 Daily / روزانہ {editingId && <span className="text-orange-600 text-[9px]">(Editing)</span>}</h1>
          <div className="space-y-2 sm:space-y-3">
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">Date / تاریخ</label><input type="date" value={form.date} onChange={(e)=>setForm({...form,date:e.target.value})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5" /></div>
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">Size / سائز</label><select value={form.blockType} onChange={(e)=>setForm({...form,blockType:e.target.value as BlockTypeOption})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5 bg-white"><option>4 inch</option><option>5 inch</option><option>6 inch</option><option>8 inch</option></select></div>
            </div>
            <div>
              <label className="text-[9px] sm:text-[10px] font-bold text-gray-600">Block Name / بلاک نام</label>
              <select value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5 bg-white">{blockOptions.map((name, idx) => (<option key={`${name}-${idx}`} value={name}>{name}</option>))}</select>
              <input type="text" placeholder="Or type new name" value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">Cement بوری</label><input type="number" value={form.cementBags} onChange={(e)=>setForm({...form,cementBags:Number(e.target.value)})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5" /></div>
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-600">Rate / ریٹ</label><input type="number" value={form.ratePerBlock} onChange={(e)=>setForm({...form,ratePerBlock:Number(e.target.value)})} className="w-full border p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-[11px] sm:text-[12px] mt-0.5" /></div>
            </div>
            <div className="border-t pt-2">
              <label className="font-bold text-[10px] sm:text-[11px]">Bill / بل</label>
              {displayBills.map((b, idx) => (
                <div key={idx} className="flex gap-1 mt-1.5">
                  <input value={b.label} onChange={e=>updateBill(idx, "label", e.target.value)} placeholder="Label" className={`flex-1 border p-1.5 sm:p-2 rounded-lg sm:rounded-xl text-[10px] sm:text-[11px] ${isElectricLabel(b.label) ? 'border-orange-400 bg-orange-50' : ''}`} />
                  <input type="number" value={b.amount} onChange={e=>updateBill(idx, "amount", e.target.value)} placeholder="Rs" className="w-[60px] sm:w-[75px] border p-1.5 sm:p-2 rounded-lg sm:rounded-xl text-[10px] sm:text-[11px]" />
                  <button onClick={()=>removeBill(idx)} className="px-2 bg-red-50 text-red-600 border border-red-200 rounded-lg sm:rounded-xl text-[10px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1 mt-1.5 bg-gray-50 p-1.5 rounded-lg sm:rounded-xl border border-dashed">
                <input value={newBillLabel} onChange={e=>setNewBillLabel(e.target.value)} placeholder="New Label" className="flex-1 border p-1.5 rounded-lg text-[10px] bg-white" />
                <input type="number" value={newBillAmount} onChange={e=>setNewBillAmount(Number(e.target.value))} placeholder="Rs" className="w-[50px] border p-1.5 rounded-lg text-[10px] bg-white" />
                <button onClick={addBill} className="px-2.5 bg-black text-white rounded-lg font-bold text-[10px]">+Add</button>
              </div>
            </div>
            <div className="border-t pt-2">
              <label className="font-bold text-[10px] sm:text-[11px]">Mix / مکس - {mixCost} Rs (avgRate from trolley stock)</label>
              {mixMaterials.map((m, idx) => (
                <div key={idx} className="flex gap-1 mt-1.5">
                  <input value={m.label} onChange={e=>updateMix(idx, "label", e.target.value)} placeholder="Material" className="flex-1 border p-1.5 rounded-lg text-[10px] sm:text-[11px]" />
                  <input type="number" value={m.rairi} onChange={e=>updateMix(idx, "rairi", e.target.value)} placeholder="Rairi" className="w-[50px] border p-1.5 rounded-lg text-[10px]" />
                  <input type="number" value={m.rate} onChange={e=>updateMix(idx, "rate", e.target.value)} placeholder="Rate" className="w-[60px] border p-1.5 rounded-lg text-[10px]" />
                  <span className="w-[60px] bg-gray-100 border p-1.5 rounded-lg text-[10px] text-center font-bold">{m.amount} Rs</span>
                  <button onClick={()=>removeMix(idx)} className="px-2 bg-red-50 text-red-600 border rounded-lg text-[10px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1 mt-1.5 bg-blue-50 p-1.5 rounded-lg border border-dashed border-blue-200">
                <select value={newMixLabel} onChange={e=>{
                  const val = e.target.value;
                  setNewMixLabel(val);
                  const stock = trolleyStocks.find(s => s.material === val);
                  if (stock) setNewMixRate(stock.avgRate);
                }} className="flex-1 border p-1.5 rounded-lg text-[10px] bg-white">
                  <option value="">Select Material</option>
                  {trolleyStocks.map(s => <option key={s.localId} value={s.material}>{s.material} ({s.totalRairi}R @ {s.avgRate}Rs)</option>)}
                </select>
                <input type="number" value={newMixRairi || ""} onChange={e=>setNewMixRairi(Number(e.target.value))} placeholder="Rairi" className="w-[50px] border p-1.5 rounded-lg text-[10px] bg-white" />
                <input type="number" value={newMixRate || ""} onChange={e=>setNewMixRate(Number(e.target.value))} placeholder="Rate" className="w-[60px] border p-1.5 rounded-lg text-[10px] bg-white" />
                <button onClick={addMix} className="px-2.5 bg-[#0f4fb8] text-white rounded-lg font-bold text-[10px]">+Add</button>
              </div>
            </div>
            <div>
              <label className="text-[9px] sm:text-[10px] font-bold text-gray-600">Count / تعداد</label>
              <div className="flex gap-1.5 mt-0.5"><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:Math.max(0,f.blocksCount-1)}))} className="px-3 py-1.5 border rounded-lg font-bold bg-gray-100 text-[11px]">-1</button><input type="number" value={form.blocksCount} onChange={(e)=>setForm({...form,blocksCount:Number(e.target.value)})} className="flex-1 border p-1.5 rounded-lg text-center font-bold text-[12px] sm:text-[13px]" /><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:f.blocksCount+1}))} className="px-3 py-1.5 border rounded-lg font-bold bg-gray-100 text-[11px]">+1</button></div>
            </div>
            <div className="bg-[#0f4fb8]/10 p-2 rounded-lg border text-[10px] sm:text-[11px] font-bold">
              مزدوری: {form.blocksCount} x {form.ratePerBlock} = {wages} Rs | مکس: {mixCost} Rs | کل بل: {totalBill} Rs | فی بلاک: {form.blocksCount>0 ? (totalBill/form.blocksCount).toFixed(2) : 0} Rs
            </div>
            <button onClick={()=>void handleSubmit()} disabled={saving} className="w-full bg-black text-white p-2.5 sm:p-3 rounded-xl font-bold text-[11px] sm:text-[12px]">{saving ? "Saving..." : editingId ? "Update" : `Save ${form.blocksCount} Blocks`}</button>
            {editingId && <button onClick={()=>{ setEditingId(null); setEditingLocalId(null); setForm((f)=>({...f, date: getPKDate(), blocksCount:798})); setBills([{label:"Labour Bill", amount:wages},{label:"Lunch Bill", amount:0}]); setMixMaterials([]); }} className="w-full border p-2 rounded-xl text-[10px] font-bold">Cancel</button>}
          </div>
        </div>

        <div className="bg-white border rounded-xl sm:rounded-2xl p-1.5 sm:p-3 shadow-sm">
          <div className="flex items-center gap-1.5 mb-2">
            <h2 className="font-bold text-[10px] sm:text-[12px] flex-1 leading-3">📋 {filtered.length} | {totalBlocks} نغ | {grandTotal} Rs | Mix {grandMix} Rs</h2>
            <button onClick={exportExcel} className="px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-[9px] sm:text-[11px] font-bold whitespace-nowrap">⬇️ Excel</button>
          </div>
          <input placeholder="Search..." value={filter} onChange={(e)=>setFilter(e.target.value)} className="w-full border p-1.5 sm:p-2 rounded-lg text-[10px] sm:text-[11px] mb-2"/>
          <div className="overflow-x-auto rounded-lg border -mx-1 sm:mx-0">
            <div className="min-w-[680px]">
              <table className="w-full text-[9px] sm:text-[10px]">
                <thead className="bg-gray-100 sticky top-0">
                  <tr className="text-[8px] sm:text-[9px]">
                    <th className="p-1.5 sm:p-2 text-left min-w-[75px]">Date</th>
                    <th className="p-1.5 sm:p-2 text-left min-w-[110px]">Name</th>
                    <th className="p-1.5 sm:p-2 text-center">Count</th>
                    <th className="p-1.5 sm:p-2 text-center">MixCost</th>
                    <th className="p-1.5 sm:p-2 text-left min-w-[120px]">Mix Detail</th>
                    <th className="p-1.5 sm:p-2 text-right">Total</th>
                    <th className="p-1.5 sm:p-2 text-center">Per Block</th>
                    <th className="p-1.5 sm:p-2 text-center min-w-[70px]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r)=>
                    <tr key={r.localId} className="border-t hover:bg-gray-50">
                      <td className="p-1.5 whitespace-nowrap text-[9px]">{r.date}<br/><span className="text-[7px] text-gray-500">{r.blockType}</span></td>
                      <td className="p-1.5 font-bold text-[9px] leading-3">{r.blocksMade}</td>
                      <td className="p-1.5 text-center font-bold">{r.blocksCount}</td>
                      <td className="p-1.5 text-center font-bold text-blue-600">{r.mixCost||0}</td>
                      <td className="p-1.5 text-[8px] leading-3 max-w-[150px] truncate">{(r.mixMaterials||[]).map(m=>`${m.label}:${m.rairi}R x ${m.rate}=${m.amount}Rs`).join(" | ")}</td>
                      <td className="p-1.5 text-right font-bold whitespace-nowrap">{r.totalBill||r.dailyWages}</td>
                      <td className="p-1.5 text-center font-bold">{r.costPerBlock ? Number(r.costPerBlock).toFixed(2) : "0"}</td>
                      <td className="p-1.5"><div className="flex gap-0.5 justify-center"><button onClick={()=>handleEdit(r)} className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-[8px]">Edit</button><button onClick={()=>void handleDelete(r)} className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[8px]">Del</button></div></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {filtered.length===0 && <div className="text-center text-[10px] text-gray-400 py-4">No records</div>}
          <div className="text-[8px] text-gray-400 mt-1.5 text-center">← Swipe to see full table →</div>
        </div>
      </div>
    </div>
  );
}