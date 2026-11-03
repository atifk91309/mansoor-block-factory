"use client";
import { useEffect, useState, useMemo } from "react";
import { offlineDB } from "@/lib/offline-db";
import { saveBlockDailyOffline, BlockDailyInput } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";
import type { OfflineBlockDaily, BillEntry, MixMaterialEntry } from "@/lib/offline-db";
import * as XLSX from "xlsx";

type BlockTypeOption = "4 inch" | "5 inch" | "6 inch" | "8 inch";
type OfflineUser = { _id?: string; id?: string } | null;
type FormState = { 
  date: string; 
  cementBags: number; 
  blocksMade: string; 
  blocksCount: number; 
  blockType: BlockTypeOption; 
  ratePerBlock: number;
  isMonthlyElectricity: boolean;
};

type BlockDailyDoc = {
  _id: string;
  localId?: string;
  date: string;
  cementBags: number;
  blocksMade: string;
  blocksCount: number;
  dailyWages: number;
  ratePerBlock: number;
  blockType: string;
  userId: string;
  createdAt: string;
  bills?: BillEntry[];
  mixMaterials?: MixMaterialEntry[];
  totalBill?: number;
  costPerBlock?: number;
  isMonthlyElectricity?: boolean;
};

type ApiResponse = { data?: BlockDailyDoc[]; blockDailies?: BlockDailyDoc[]; };

const DEFAULT_BLOCKS = ["Shaga Block", "Full crush Block", "Mix Crush Block", "One khahta", "3Number Khahta", "Concar Khahta", "mix crush Block"];

function getPKDate(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 300);
  return d.toISOString().split("T")[0];
}
function rnd(n: number): number { return Math.round(Number(n) || 0); }
function isElectricLabel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("electric") || l.includes("bijli") || l.includes("بجلی") || l.includes("wapda");
}

export default function BlockDailyPage() {
  const [form, setForm] = useState<FormState>({
    date: getPKDate(), cementBags: 8, blocksMade: "6 inch Block", blocksCount: 798, blockType: "6 inch", ratePerBlock: 3, isMonthlyElectricity: false,
  });
  const [bills, setBills] = useState<BillEntry[]>([
    { label: "Labour Bill", amount: 0 },
    { label: "Lunch Bill", amount: 0 },
  ]);
  const [newBillLabel, setNewBillLabel] = useState("");
  const [newBillAmount, setNewBillAmount] = useState(0);
  const [mixMaterials, setMixMaterials] = useState<MixMaterialEntry[]>([]);
  const [newMixLabel, setNewMixLabel] = useState("");
  const [newMixQty, setNewMixQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [blockOptions, setBlockOptions] = useState<string[]>(DEFAULT_BLOCKS);
  const [history, setHistory] = useState<OfflineBlockDaily[]>([]);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);

  const wages = useMemo(() => rnd(form.blocksCount * form.ratePerBlock), [form.blocksCount, form.ratePerBlock]);
  
  const totalBill = useMemo(() => {
    const extra = bills.reduce((s, b) => {
      if (b.label.toLowerCase().includes("labour")) return s;
      if (isElectricLabel(b.label)) return s;
      return s + (b.amount || 0);
    }, 0);
    return wages + extra;
  }, [bills, wages]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBills(prev => prev.map(b => b.label.toLowerCase().includes("labour") ? { ...b, amount: wages } : b));
  }, [wages]);

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
            localId: d.localId || d._id || `daily_${d._id}`,
            _id: d._id,
            date: new Date(d.date).toISOString().split("T")[0],
            cementBags: d.cementBags,
            blocksMade: d.blocksMade,
            blocksCount: d.blocksCount,
            dailyWages: d.dailyWages,
            ratePerBlock: d.ratePerBlock,
            blockType: d.blockType,
            userId: d.userId,
            synced: 1,
            createdAt: d.createdAt,
            bills: d.bills || [],
            mixMaterials: d.mixMaterials || [],
            totalBill: d.totalBill || d.dailyWages,
            costPerBlock: d.costPerBlock || 0,
            isMonthlyElectricity: d.isMonthlyElectricity || false,
          }));
          setHistory(mapped.sort((a,b) => b.date.localeCompare(a.date)));
        }
      }
    } catch {}
  }

  useEffect(() => {
    async function loadProducts(): Promise<void> {
      try {
        const products = await offlineDB.blockProducts.where("category").equals("block").toArray();
        if (products.length > 0) {
          const map = new Map<string, string>();
          for (const p of products) {
            const name = p.name.trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (!map.has(key)) map.set(key, name);
          }
          const unique = Array.from(map.values()).sort((a, b) => a.localeCompare(b));
          if (unique.length > 0) setBlockOptions(unique);
        }
      } catch {}
      void loadHistory();
    }
    void loadProducts();
  }, []);

  async function getUserId(): Promise<string> {
    try {
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const data = (await res.json()) as { user?: { id?: string; _id?: string } };
        if (data?.user?.id) return data.user.id;
        if (data?.user?._id) return data.user._id;
      }
    } catch {}
    const offlineUser = getOfflineUser() as OfflineUser;
    return offlineUser?._id || offlineUser?.id || "offline_user";
  }

  const addBill = () => {
    if (!newBillLabel.trim()) return;
    setBills([...bills, { label: newBillLabel.trim(), amount: rnd(newBillAmount || 0) }]);
    setNewBillLabel(""); setNewBillAmount(0);
  };
  const updateBill = (idx: number, field: "label"|"amount", val: string|number) => {
    const copy = [...bills];
    if (field === "label") copy[idx].label = val as string;
    else copy[idx].amount = rnd(Number(val) || 0);
    setBills(copy);
  };
  const removeBill = (idx: number) => setBills(bills.filter((_, i) => i !== idx));

  const addMix = () => {
    if (!newMixLabel.trim()) return;
    setMixMaterials([...mixMaterials, { label: newMixLabel.trim(), qty: newMixQty.trim() || "1 Hath" }]);
    setNewMixLabel(""); setNewMixQty("");
  };
  const updateMix = (idx: number, field: "label"|"qty", val: string) => {
    const copy = [...mixMaterials];
    if (field === "label") copy[idx].label = val;
    else copy[idx].qty = val;
    setMixMaterials(copy);
  };
  const removeMix = (idx: number) => setMixMaterials(mixMaterials.filter((_, i) => i !== idx));

  async function handleSubmit(): Promise<void> {
    if (!form.blocksMade.trim() || form.blocksCount <= 0) { alert("Check name & count"); return; }
    setSaving(true);
    try {
      const userId = await getUserId();
      const payload: BlockDailyInput = {
        date: form.date, cementBags: form.cementBags, blocksMade: form.blocksMade, blocksCount: form.blocksCount,
        blockType: form.blockType, ratePerBlock: form.ratePerBlock, isMonthlyElectricity: form.isMonthlyElectricity,
        dailyWages: wages, bills: bills.filter(b => b.label.trim()), mixMaterials: mixMaterials.filter(m => m.label.trim()),
        totalBill, userId,
      };
      if (editingId && editingLocalId) {
        if (navigator.onLine) {
          await fetch(`/api/block-daily/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        }
        await offlineDB.blockDaily.update(editingLocalId, {
          date: form.date, cementBags: rnd(form.cementBags), blocksMade: form.blocksMade, blocksCount: rnd(form.blocksCount),
          blockType: form.blockType, ratePerBlock: rnd(form.ratePerBlock), dailyWages: wages, bills, mixMaterials, totalBill,
          isMonthlyElectricity: form.isMonthlyElectricity, synced: navigator.onLine ? 1 : 0,
        });
        setEditingId(null); setEditingLocalId(null);
      } else {
        const localId = await saveBlockDailyOffline(payload);
        if (navigator.onLine) {
          try {
            const res = await fetch("/api/block-daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, localId }) });
            if (res.ok) await offlineDB.blockDaily.update(localId, { synced: 1 });
          } catch {}
        }
      }
      await loadHistory();
      setForm((f) => ({ ...f, date: getPKDate(), blocksCount: 798 }));
      setBills([{ label: "Labour Bill", amount: wages }, { label: "Lunch Bill", amount: 0 }]);
      setMixMaterials([]);
    } finally { setSaving(false); }
  }

  function handleEdit(item: OfflineBlockDaily): void {
    setForm({
      date: item.date, cementBags: item.cementBags, blocksMade: item.blocksMade, blocksCount: item.blocksCount,
      blockType: item.blockType as BlockTypeOption, ratePerBlock: item.ratePerBlock, isMonthlyElectricity: item.isMonthlyElectricity || false,
    });
    setBills(item.bills && item.bills.length > 0 ? item.bills : [{ label: "Labour Bill", amount: item.dailyWages }]);
    setMixMaterials(item.mixMaterials || []);
    setEditingId(item._id || item.localId); setEditingLocalId(item.localId);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

    const allMixLabels = Array.from(new Set(
      rows.flatMap(r => (r.mixMaterials || []).map(m => m.label.trim()).filter(Boolean))
    )).sort();

    const allBillLabels = Array.from(new Set(
      rows.flatMap(r => (r.bills || []).map(b => b.label.trim()).filter(Boolean))
    )).sort();

    // --- HEADER ROWS ---
    const headerMain = ["MOHAL - منصور بلاک فیکٹری - Daily Production Report / روزانہ پیداوار رپورٹ"];
    const headerSummary = [`Date: ${getPKDate()} | Records: ${rows.length} | Blocks: ${rows.reduce((s,r)=>s+r.blocksCount,0)} | Bori: ${rows.reduce((s,r)=>s+r.cementBags,0)} | Grand Total: ${rows.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0)} Rs`];
    
    const tableHeader = [
      "Date / تاریخ",
      "Block Name / بلاک نام",
      "Size / سائز",
      "Count / تعداد (نغ)",
      "Bags / بوری",
      "Rate / ریٹ",
      "Wages / مزدوری",
      "Labour Bill",
      "Lunch Bill / لنچ",
      "Other Bills / دیگر بل",
      ...allMixLabels.map(l => `Mix: ${l}`),
      "All Mix Detail / تمام مکس",
      "Total Bill / کل بل",
      "Cost Per Block / فی بلاک خرچ",
      "Electric Monthly? / بجلی ماہانہ",
      "Status / سٹیٹس"
    ];

    const sheetData: (string | number)[][] = [
      headerMain,
      headerSummary,
      [],
      tableHeader,
      ...rows.map((r) => {
        const getBillAmount = (search: string) => {
          const found = r.bills?.find(b => b.label.toLowerCase().includes(search.toLowerCase()));
          return found ? found.amount : 0;
        };
        const otherBills = (r.bills||[])
          .filter(b => !b.label.toLowerCase().includes("labour") && !b.label.toLowerCase().includes("lunch") && !isElectricLabel(b.label))
          .map(b=>`${b.label}: ${b.amount} Rs`)
          .join(" | ");

        const mixMap = new Map((r.mixMaterials||[]).map(m => [m.label.trim(), m.qty]));
        const mixCols = allMixLabels.map(lbl => mixMap.get(lbl) || "");
        const allMix = (r.mixMaterials||[]).map(m=>`${m.label}: ${m.qty}`).join(" | ");

        return [
          r.date,
          r.blocksMade,
          r.blockType,
          r.blocksCount,
          r.cementBags,
          r.ratePerBlock,
          r.dailyWages,
          getBillAmount("labour") || r.dailyWages,
          getBillAmount("lunch"),
          otherBills || "-",
          ...mixCols,
          allMix || "-",
          r.totalBill || r.dailyWages,
          r.costPerBlock ? Number(r.costPerBlock).toFixed(2) : Number(((r.totalBill||r.dailyWages||0)/(r.blocksCount||1)).toFixed(2)),
          r.isMonthlyElectricity ? "Yes - Monthly" : "No",
          r.synced === 1 ? "Synced" : "Pending"
        ] as (string | number)[];
      }),
      [],
      ["Summary / خلاصہ"],
      ["کل بلاکس / Total Blocks", rows.reduce((s,r)=>s+r.blocksCount,0)],
      ["کل سیمنٹ بوری / Total Bori", rows.reduce((s,r)=>s+r.cementBags,0)],
      ["کل مزدوری / Total Wages", rows.reduce((s,r)=>s+r.dailyWages,0)],
      ["کل بل / Grand Total", rows.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0)],
      ["تمام بل لیبلز / All Bill Types", allBillLabels.join(" | ")],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // --- FIX FOR YOUR SCREENSHOT: WIDE COLUMNS + WRAP TEXT ---
    ws["!cols"] = [
      { wch: 14 }, // Date
      { wch: 22 }, // Block Name - was 12, now 22 shows full name
      { wch: 10 }, // Size
      { wch: 12 }, // Count
      { wch: 10 }, // Bags
      { wch: 8 },  // Rate
      { wch: 12 }, // Wages
      { wch: 14 }, // Labour
      { wch: 14 }, // Lunch
      { wch: 30 }, // Other Bills - was 25, now 30
      ...allMixLabels.map(() => ({ wch: 18 })), // Each Mix column 18 width
      { wch: 40 }, // All Mix Detail - was hidden, now 40
      { wch: 14 }, // Total
      { wch: 14 }, // Cost/Block
      { wch: 18 }, // Electric
      { wch: 12 }, // Status
    ];

    // Merge title rows
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: tableHeader.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: tableHeader.length - 1 } },
    ];

    // Auto filter + Freeze header
    ws["!autofilter"] = { ref: `A4:${XLSX.utils.encode_col(tableHeader.length - 1)}4` };
    ws["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", state: "frozen" };

    // Style header row bold (if supported)
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:Q100");
    for(let C = range.s.c; C <= range.e.c; ++C) {
      const address = XLSX.utils.encode_cell({r:3, c:C});
      if(!ws[address]) continue;
      
      ws[address].s = { font: { bold: true }, alignment: { wrapText: true } };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `MOHAL Daily ${getPKDate()}`);
    XLSX.writeFile(wb, `MOHAL_Daily_Urdu_Full_${getPKDate()}_${rows.reduce((s,r)=>s+r.blocksCount,0)}Blocks.xlsx`);
  }

  const filtered = history.filter((h) => !filter || h.blocksMade.toLowerCase().includes(filter.toLowerCase()));
  const grandTotal = filtered.reduce((s,r)=>s+(r.totalBill||r.dailyWages||0),0);
  const totalBlocks = filtered.reduce((s,r)=>s+r.blocksCount,0);

  return (
    <div className="min-h-screen bg-gray-50 py-2 sm:py-4">
      <div className="max-w-[980px] mx-auto px-2 sm:px-4 space-y-3">
        
        <div className="bg-white border rounded-2xl p-3 sm:p-5 shadow-sm">
          <h1 className="font-bold text-[14px] sm:text-[16px] mb-3">🧱 Daily Production / روزانہ پیداوار {editingId && <span className="text-orange-600 text-[11px]">(Editing)</span>}</h1>
          
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] font-bold text-gray-600">Date / تاریخ</label><input type="date" value={form.date} onChange={(e)=>setForm({...form,date:e.target.value})} className="w-full border p-2.5 rounded-xl text-[12px] mt-1" /></div>
              <div><label className="text-[10px] font-bold text-gray-600">Size / سائز</label><select value={form.blockType} onChange={(e)=>setForm({...form,blockType:e.target.value as BlockTypeOption})} className="w-full border p-2.5 rounded-xl text-[12px] mt-1 bg-white"><option>4 inch</option><option>5 inch</option><option>6 inch</option><option>8 inch</option></select></div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-600">Block Name / بلاک نام</label>
              <select value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-2.5 rounded-xl text-[12px] mt-1 bg-white">{blockOptions.map((name, idx) => (<option key={`${name}-${idx}`} value={name}>{name}</option>))}</select>
              <input type="text" placeholder="Or type new name / نیا نام" value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-2.5 rounded-xl text-[12px] mt-2" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] font-bold text-gray-600">Cement بوری</label><input type="number" value={form.cementBags} onChange={(e)=>setForm({...form,cementBags:Number(e.target.value)})} className="w-full border p-2.5 rounded-xl text-[12px] mt-1" /></div>
              <div><label className="text-[10px] font-bold text-gray-600">Rate / ریٹ</label><input type="number" value={form.ratePerBlock} onChange={(e)=>setForm({...form,ratePerBlock:Number(e.target.value)})} className="w-full border p-2.5 rounded-xl text-[12px] mt-1" /></div>
            </div>

            <div className="border-t pt-3">
              <label className="font-bold text-[12px]">Bill / بل</label>
              {bills.map((b, idx) => (
                <div key={idx} className="flex gap-1.5 mt-2">
                  <input value={b.label} onChange={e=>updateBill(idx, "label", e.target.value)} placeholder="Label" className={`flex-1 border p-2.5 rounded-xl text-[12px] ${isElectricLabel(b.label) ? 'border-orange-400 bg-orange-50' : ''}`} />
                  <input type="number" value={b.amount} onChange={e=>updateBill(idx, "amount", e.target.value)} placeholder="Rs" className="w-[75px] border p-2.5 rounded-xl text-[12px]" />
                  <button onClick={()=>removeBill(idx)} className="px-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-[12px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1.5 mt-2 bg-gray-50 p-2 rounded-xl border border-dashed">
                <input value={newBillLabel} onChange={e=>setNewBillLabel(e.target.value)} placeholder="New Label" className="flex-1 border p-2.5 rounded-xl text-[11px] bg-white" />
                <input type="number" value={newBillAmount} onChange={e=>setNewBillAmount(Number(e.target.value))} placeholder="Rs" className="w-[60px] border p-2.5 rounded-xl text-[11px] bg-white" />
                <button onClick={addBill} className="px-3 bg-black text-white rounded-xl font-bold text-[11px]">+Add</button>
              </div>
              <label className="flex items-center gap-2 mt-2 text-[10px]"><input type="checkbox" checked={form.isMonthlyElectricity} onChange={e=>setForm({...form,isMonthlyElectricity:e.target.checked})} /> Electricity monthly / بجلی ماہانہ</label>
            </div>

            <div className="border-t pt-3">
              <label className="font-bold text-[12px]">Mix Material / مکس</label>
              {mixMaterials.map((m, idx) => (
                <div key={idx} className="flex gap-1.5 mt-2">
                  <input value={m.label} onChange={e=>updateMix(idx, "label", e.target.value)} placeholder="Material" className="flex-1 border p-2.5 rounded-xl text-[12px]" />
                  <input value={m.qty} onChange={e=>updateMix(idx, "qty", e.target.value)} placeholder="Qty" className="w-[95px] border p-2.5 rounded-xl text-[12px]" />
                  <button onClick={()=>removeMix(idx)} className="px-2.5 bg-red-50 text-red-600 border rounded-xl text-[12px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1.5 mt-2 bg-blue-50 p-2 rounded-xl border border-dashed border-blue-200">
                <input value={newMixLabel} onChange={e=>setNewMixLabel(e.target.value)} placeholder="New Material" className="flex-1 border p-2.5 rounded-xl text-[11px] bg-white" />
                <input value={newMixQty} onChange={e=>setNewMixQty(e.target.value)} placeholder="Hath" className="w-[70px] border p-2.5 rounded-xl text-[11px] bg-white" />
                <button onClick={addMix} className="px-3 bg-[#0f4fb8] text-white rounded-xl font-bold text-[11px]">+Add</button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-600">Blocks Count / تعداد (نغ)</label>
              <div className="flex gap-2 mt-1"><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:Math.max(0,f.blocksCount-1)}))} className="px-4 py-2.5 border rounded-xl font-bold bg-gray-100 text-[13px]">-1</button><input type="number" value={form.blocksCount} onChange={(e)=>setForm({...form,blocksCount:Number(e.target.value)})} className="flex-1 border p-2.5 rounded-xl text-center font-bold text-[14px]" /><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:f.blocksCount+1}))} className="px-4 py-2.5 border rounded-xl font-bold bg-gray-100 text-[13px]">+1</button></div>
            </div>

            <div className="bg-[#0f4fb8]/10 p-3 rounded-xl border text-[12px] font-bold leading-5">
              مزدوری: {form.blocksCount} x {form.ratePerBlock} = {wages} Rs | کل بل: {totalBill} Rs
            </div>

            <button onClick={()=>void handleSubmit()} disabled={saving} className="w-full bg-black text-white p-3.5 rounded-xl font-bold text-[13px]">{saving ? "Saving..." : editingId ? "Update / اپڈیٹ" : `Save ${form.blocksCount} Blocks`}</button>
            {editingId && <button onClick={()=>{ setEditingId(null); setEditingLocalId(null); setForm((f)=>({...f, date: getPKDate(), blocksCount:798})); setBills([{label:"Labour Bill", amount:wages},{label:"Lunch Bill", amount:0}]); setMixMaterials([]); }} className="w-full border p-2.5 rounded-xl text-[11px] font-bold">Cancel</button>}
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-2 sm:p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <h2 className="font-bold text-[11px] sm:text-[13px] flex-1 leading-4">📋 {filtered.length} ریکارڈ | {totalBlocks} بلاکس | Total: {grandTotal} Rs</h2>
            <button onClick={exportExcel} className="px-3 py-2 bg-green-600 text-white rounded-xl text-[11px] font-bold whitespace-nowrap">⬇️ Excel</button>
          </div>
          <input placeholder="Search / تلاش..." value={filter} onChange={(e)=>setFilter(e.target.value)} className="w-full border p-2.5 rounded-xl text-[12px] mb-3"/>
          
          {/* TABLE FOR BOTH MOBILE AND DESKTOP - HORIZONTAL SCROLL */}
          <div className="overflow-x-auto -mx-2 sm:mx-0 rounded-xl border">
            <div className="min-w-[720px]">
              <table className="w-full text-[11px]">
                <thead className="bg-gray-100 sticky top-0">
                  <tr className="text-[10px]">
                    <th className="p-2.5 text-left min-w-[85px]">تاریخ<br/>Date</th>
                    <th className="p-2.5 text-left min-w-[130px]">نام<br/>Name</th>
                    <th className="p-2.5 text-center">تعداد<br/>Count</th>
                    <th className="p-2.5 text-center">بوری<br/>Bags</th>
                    <th className="p-2.5 text-left min-w-[150px]">بل<br/>Bills</th>
                    <th className="p-2.5 text-left min-w-[150px]">مکس<br/>Mix</th>
                    <th className="p-2.5 text-right">کل<br/>Total</th>
                    <th className="p-2.5 text-center min-w-[90px]">عمل<br/>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r)=>
                    <tr key={r.localId} className="border-t hover:bg-gray-50">
                      <td className="p-2.5 whitespace-nowrap text-[10px]">{r.date}<br/><span className="text-[9px] text-gray-500">{r.blockType}</span></td>
                      <td className="p-2.5 font-bold text-[11px] leading-3">{r.blocksMade}<br/><span className="text-[9px] font-normal text-gray-500">{r.cementBags} بوری</span></td>
                      <td className="p-2.5 text-center font-bold">{r.blocksCount}</td>
                      <td className="p-2.5 text-center">{r.cementBags}</td>
                      <td className="p-2.5 text-[9px] leading-3 max-w-[150px] truncate">{(r.bills||[]).map(b=>`${b.label}:${b.amount}`).join(" | ")}</td>
                      <td className="p-2.5 text-[9px] leading-3 max-w-[150px] truncate">{(r.mixMaterials||[]).map(m=>`${m.label}:${m.qty}`).join(" | ")}</td>
                      <td className="p-2.5 text-right font-bold whitespace-nowrap">{r.totalBill||r.dailyWages} Rs</td>
                      <td className="p-2.5"><div className="flex gap-1 justify-center"><button onClick={()=>handleEdit(r)} className="px-2 py-1 bg-blue-600 text-white rounded text-[9px]">Edit</button><button onClick={()=>void handleDelete(r)} className="px-2 py-1 bg-red-600 text-white rounded text-[9px]">Del</button></div></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {filtered.length===0 && <div className="text-center text-[11px] text-gray-400 py-6">کوئی ریکارڈ نہیں / No records</div>}
          <div className="text-[9px] text-gray-400 mt-2 text-center sm:hidden">← Scroll left/right to see full table / ٹیبل دیکھنے کے لیے اسکرول کریں →</div>
        </div>
      </div>
    </div>
  );
}