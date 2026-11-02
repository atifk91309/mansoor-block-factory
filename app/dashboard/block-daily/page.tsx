"use client";
import { useEffect, useState } from "react";
import { offlineDB } from "@/lib/offline-db";
import { saveBlockDailyOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";
import type { OfflineBlockDaily } from "@/lib/offline-db";
import * as XLSX from "xlsx";

type BlockTypeOption = "4 inch" | "6 inch" | "8 inch";
type OfflineUser = { _id?: string; id?: string } | null;
type FormState = { date: string; cementBags: number; blocksMade: string; blocksCount: number; blockType: BlockTypeOption; ratePerBlock: number; };

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
};

type ApiResponse = { data?: BlockDailyDoc[]; blockDailies?: BlockDailyDoc[]; };

const DEFAULT_BLOCKS = ["Shaga Block", "Full crush Block", "Mix Crush Block", "One khahta", "3Number Khahta", "Concar Khahta"];

// ✅ FIX: PK local date, not UTC
function getPKDate(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 300);
  return d.toISOString().split("T")[0];
}

export default function BlockDailyPage() {
  const [form, setForm] = useState<FormState>({
    date: getPKDate(), cementBags: 8, blocksMade: "6 inch Block", blocksCount: 798, blockType: "6 inch", ratePerBlock: 3,
  });
  const [saving, setSaving] = useState(false);
  const [blockOptions, setBlockOptions] = useState<string[]>(DEFAULT_BLOCKS);
  const [history, setHistory] = useState<OfflineBlockDaily[]>([]);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);

  const wages = Math.round(form.blocksCount * form.ratePerBlock);

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

  async function handleSubmit(): Promise<void> {
    if (!form.blocksMade.trim() || form.blocksCount <= 0) { alert("Check name & count"); return; }
    setSaving(true);
    try {
      const userId = await getUserId();
      if (editingId && editingLocalId) {
        if (navigator.onLine) {
          await fetch(`/api/block-daily/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, dailyWages: wages }) });
        }
        await offlineDB.blockDaily.update(editingLocalId, { ...form, dailyWages: wages, synced: navigator.onLine ? 1 : 0 });
        setEditingId(null);
        setEditingLocalId(null);
      } else {
        const localId = await saveBlockDailyOffline({ ...form, userId });
        if (navigator.onLine) {
          try {
            const res = await fetch("/api/block-daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, dailyWages: wages, localId, userId }) });
            if (res.ok) await offlineDB.blockDaily.update(localId, { synced: 1 });
          } catch {}
        }
      }
      await loadHistory();
      setForm((f) => ({ ...f, date: getPKDate(), blocksCount: 798 }));
    } finally { setSaving(false); }
  }

  function handleEdit(item: OfflineBlockDaily): void {
    setForm({
      date: item.date,
      cementBags: item.cementBags,
      blocksMade: item.blocksMade,
      blocksCount: item.blocksCount,
      blockType: item.blockType as BlockTypeOption,
      ratePerBlock: item.ratePerBlock,
    });
    setEditingId(item._id || item.localId);
    setEditingLocalId(item.localId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(item: OfflineBlockDaily): Promise<void> {
    if (!confirm(`Delete ${item.blocksMade} - ${item.blocksCount}?`)) return;
    await offlineDB.blockDaily.delete(item.localId);
    if (navigator.onLine && item._id) {
      try { await fetch(`/api/block-daily/${item._id}`, { method: "DELETE" }); } catch {}
    }
    setHistory((h) => h.filter((x) => x.localId !== item.localId));
  }

  function exportCSV(): void {
    const rows = history.filter((h) => !filter || h.blocksMade.toLowerCase().includes(filter.toLowerCase()));
    if (rows.length === 0) { alert("No data"); return; }
    const totalCement = rows.reduce((s,r) => s + r.cementBags, 0);
    const totalBlocks = rows.reduce((s,r) => s + r.blocksCount, 0);
    const totalWages = rows.reduce((s,r) => s + r.dailyWages, 0);
    const data = [
      ["Mansoor Block Factory - Mohal - Daily Production / منصور بلاک فیکٹری - روزانہ پیداوار"],
      [`Total: ${totalBlocks} Blocks / بلاکس, ${totalCement} Bori / بوری سیمنٹ, ${totalWages} Rs Wages / مزدوری`],
      [],
      ["Date / تاریخ", "Block Name / نام", "Block Type / سائز", "Count / تعداد (نغ)", "Cement / سیمنٹ بوری", "Rate / ریٹ", "Daily Wages / مزدوری"], 
      ...rows.map((r) => [r.date, r.blocksMade, r.blockType, r.blocksCount, r.cementBags, r.ratePerBlock, r.dailyWages])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 18 }];
    const wb = XLSX.utils.book_new(); 
    XLSX.utils.book_append_sheet(wb, ws, "Mansoor Daily"); 
    XLSX.writeFile(wb, `MOHAL_Block_Daily_${getPKDate()}_${totalBlocks}Blocks_${totalCement}Bori.xlsx`);
  }

  function shareWhatsApp(): void {
    const rows = history.slice(0,20);
    const totalCement = history.reduce((s,r) => s + r.cementBags, 0);
    const totalBlocks = history.reduce((s,r) => s + r.blocksCount, 0);
    const text = `*🧱 MOHAL - Mansoor Block Factory*\n*تاریخ: ${getPKDate()}*\nTotal: ${totalBlocks} Blocks / بلاکس | ${totalCement} Bori / بوری\n\n` + rows.map((r) => `${r.date} | ${r.blocksMade} (${r.blockType}) = ${r.blocksCount} نغ | ${r.cementBags} بوری | ${r.dailyWages} مزدوری`).join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  const filtered = history.filter((h) => !filter || h.blocksMade.toLowerCase().includes(filter.toLowerCase()));
  const totalCementFiltered = filtered.reduce((s,r) => s + r.cementBags, 0);
  const totalBlocksFiltered = filtered.reduce((s,r) => s + r.blocksCount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-350 mx-auto p-2 sm:p-3 md:p-4 flex flex-col lg:flex-row gap-2 sm:gap-4">
        <div className="w-full lg:w-95 xl:w-100 shrink-0">
          <h1 className="font-bold mb-2 sm:mb-3 text-[13px] sm:text-[15px] px-1">🧱 Daily Production / روزانہ پیداوار {editingId && <span className="text-orange-600 text-[11px]">(Editing / ترمیم)</span>}</h1>
          <div className="space-y-2 sm:space-y-3 bg-white border rounded-lg sm:rounded-xl p-2.5 sm:p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase">Date / تاریخ</label><input type="date" value={form.date} onChange={(e)=>setForm({...form,date:e.target.value})} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[12px] mt-0.5" /></div>
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase">Size / سائز</label><select value={form.blockType} onChange={(e)=>setForm({...form,blockType:e.target.value as BlockTypeOption})} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[12px] mt-0.5"><option>4 inch</option><option>6 inch</option><option>8 inch</option></select></div>
            </div>
            <div>
              <label className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase">Block Name / نام</label>
              <select value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[12px] mt-0.5 bg-white">{blockOptions.map((name, idx) => (<option key={`${name.toLowerCase()}-${idx}`} value={name}>{name}</option>))}</select>
              <input type="text" placeholder="Or type new / نیا نام لکھیں" value={form.blocksMade} onChange={(e)=>setForm({...form,blocksMade:e.target.value})} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[12px] mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase">Cement Bags / سیمنٹ بوری</label><input type="number" value={form.cementBags} onChange={(e)=>setForm({...form,cementBags:Number(e.target.value)})} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[12px] mt-0.5" /></div>
              <div><label className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase">Rate / ریٹ</label><input type="number" value={form.ratePerBlock} onChange={(e)=>setForm({...form,ratePerBlock:Number(e.target.value)})} className="w-full border p-2 sm:p-2.5 rounded-lg text-[11px] sm:text-[12px] mt-0.5" /></div>
            </div>
            <div>
              <label className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase">Blocks Count / تعداد (نغ)</label>
              <div className="flex gap-1.5 mt-1"><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:Math.max(0,f.blocksCount-1)}))} className="px-3 py-2 border rounded-lg font-bold bg-gray-100 text-[11px]">-1</button><input type="number" value={form.blocksCount} onChange={(e)=>setForm({...form,blocksCount:Number(e.target.value)})} className="flex-1 border p-2 rounded-lg text-center font-bold text-[12px]" /><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:f.blocksCount+1}))} className="px-3 py-2 border rounded-lg font-bold bg-gray-100 text-[11px]">+1</button></div>
              <div className="flex gap-1.5 mt-1.5"><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:f.blocksCount+10}))} className="flex-1 py-1.5 border rounded-md text-[10px] bg-white">+10</button><button type="button" onClick={()=>setForm((f)=>({...f,blocksCount:f.blocksCount+100}))} className="flex-1 py-1.5 border rounded-md text-[10px] bg-white">+100</button><button type="button" onClick={()=>setForm(()=>({...form,blocksCount:798}))} className="flex-1 py-1.5 border rounded-md text-[10px] bg-yellow-50 font-bold">798</button></div>
            </div>
            <p className="text-[11px] sm:text-[12px] font-bold bg-yellow-50 p-2 sm:p-2.5 rounded-lg border leading-tight">Wages / مزدوری: {form.blocksCount} x {form.ratePerBlock} = {wages} Rs<br/><span className="text-[9px] text-gray-500 font-normal">{form.blocksMade} - {form.blockType}</span></p>
            <div className="flex gap-2">
              <button onClick={()=>void handleSubmit()} disabled={saving} className="flex-1 bg-black text-white p-2.5 sm:p-3 rounded-lg font-bold text-[11px] sm:text-[12px]">{saving ? "Saving..." : editingId ? "Update / اپڈیٹ" : `Save ${form.blocksCount} - محفوظ`}</button>
              {editingId && <button onClick={()=>{ setEditingId(null); setEditingLocalId(null); setForm((f)=>({...f, date: getPKDate(), blocksCount:798})); }} className="px-4 py-2.5 border rounded-lg text-[11px] font-bold">Cancel</button>}
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 bg-white border rounded-lg sm:rounded-xl p-2 sm:p-4 shadow-sm">
          <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-2 sm:mb-3 items-center">
            <h2 className="font-bold text-[11px] sm:text-[13px] flex-1 min-w-20">📋 {filtered.length} اندراج | {totalBlocksFiltered} بلاکس / نغ | {totalCementFiltered} بوری سیمنٹ</h2>
            <button onClick={exportCSV} className="px-2 sm:px-3 py-1.5 sm:py-2 bg-green-600 text-white rounded-md sm:rounded-lg text-[10px] sm:text-[11px] font-bold">⬇️ Excel</button>
            <button onClick={shareWhatsApp} className="px-2 sm:px-3 py-1.5 sm:py-2 bg-green-500 text-white rounded-md sm:rounded-lg text-[10px] sm:text-[11px] font-bold">WA</button>
          </div>
          <input placeholder="Search block name / نام تلاش کریں..." value={filter} onChange={(e)=>setFilter(e.target.value)} className="w-full border p-2 rounded-lg text-[11px] sm:text-[12px] mb-2 sm:mb-3"/>

          <div className="grid gap-1.5 sm:hidden">
            {filtered.map((r)=><div key={r.localId} className="border rounded-lg p-2 flex justify-between items-center text-[10px]"><div><div className="font-bold text-[11px]">{r.blocksMade}</div><div className="text-[9px] text-gray-500">{r.date} • {r.blockType} • {r.cementBags} بوری • {r.blocksCount} نغ</div></div><div className="flex gap-1 items-center"><div className="text-right mr-1"><div className="font-bold">{r.dailyWages} Rs</div><div className="text-[8px] text-gray-500">مزدوری</div></div><button onClick={()=>handleEdit(r)} className="px-2 py-1 bg-blue-100 text-blue-700 rounded-md font-bold">Edit</button><button onClick={()=>void handleDelete(r)} className="px-2 py-1 bg-red-100 text-red-700 rounded-md font-bold">Del</button></div></div>)}
            {filtered.length===0 && <div className="text-center text-[11px] text-gray-400 py-8">No entries / کوئی اندراج نہیں</div>}
          </div>

          <div className="hidden sm:block overflow-auto max-h-[75vh] border rounded-lg">
            <table className="w-full text-[10px] sm:text-[11px]">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="p-1.5 sm:p-2 text-left border-r">Date<br/><span className="text-[10px] text-[#0f4fb8]">تاریخ</span></th>
                  <th className="p-1.5 sm:p-2 text-left border-r">Name<br/><span className="text-[10px] text-[#0f4fb8]">نام</span></th>
                  <th className="p-1.5 sm:p-2 text-center border-r">Type<br/><span className="text-[10px] text-[#0f4fb8]">سائز</span></th>
                  <th className="p-1.5 sm:p-2 text-center border-r">Count<br/><span className="text-[10px] text-[#0f4fb8]">تعداد / نغ</span></th>
                  <th className="p-1.5 sm:p-2 text-center border-r">Cement<br/><span className="text-[10px] text-[#0f4fb8]">سیمنٹ بوری</span></th>
                  <th className="p-1.5 sm:p-2 text-right border-r">Wages<br/><span className="text-[10px] text-[#0f4fb8]">مزدوری</span></th>
                  <th className="p-1.5 sm:p-2 text-center">Action<br/><span className="text-[10px] text-[#0f4fb8]">عمل</span></th>
                </tr>
              </thead>
            <tbody>{filtered.map((r)=><tr key={r.localId} className="border-t hover:bg-gray-50"><td className="p-1.5 sm:p-2 whitespace-nowrap">{r.date}</td><td className="p-1.5 sm:p-2 font-bold">{r.blocksMade}</td><td className="p-1.5 sm:p-2 text-center">{r.blockType}</td><td className="p-1.5 sm:p-2 text-center font-bold">{r.blocksCount}</td><td className="p-1.5 sm:p-2 text-center">{r.cementBags}</td><td className="p-1.5 sm:p-2 text-right">{r.dailyWages}</td><td className="p-1.5 sm:p-2"><div className="flex gap-1"><button onClick={()=>handleEdit(r)} className="px-2 py-1 bg-blue-600 text-white rounded text-[10px]">Edit</button><button onClick={()=>void handleDelete(r)} className="px-2 py-1 bg-red-600 text-white rounded text-[10px]">Del</button></div></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}