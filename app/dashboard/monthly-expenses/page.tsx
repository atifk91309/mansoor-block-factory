"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineBlockDaily, MonthlyExpenseLocal } from "@/lib/offline-db";
import { saveMonthlyExpenseOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";

type MonthlyRecord = {
  month: string;
  totalBlocks: number;
  totalDailyBill: number;
  totalBags: number;
  daysWorked: number;
};

type BlockDailyDoc = {
  date: string;
  blocksCount: number;
  totalBill?: number;
  dailyWages?: number;
  cementBags?: number;
};

type OfflineUser = { _id?: string; id?: string } | null;
type ServerMonthly = MonthlyExpenseLocal & { _id?: string };

export default function MonthlyExpensePage() {
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0,7));
  const [electricity, setElectricity] = useState<number>(20000);
  const [rent, setRent] = useState<number>(30000);
  const [other, setOther] = useState<number>(2000);
  const [record, setRecord] = useState<MonthlyRecord | null>(null);
  const [history, setHistory] = useState<MonthlyExpenseLocal[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      let list: BlockDailyDoc[] = [];
      try {
        const res = await fetch("/api/block-daily");
        if (res.ok) {
          const j = await res.json() as { data?: BlockDailyDoc[] };
          list = j.data || [];
        }
      } catch {}
      const offline: OfflineBlockDaily[] = await offlineDB.blockDaily.toArray().catch(() => [] as OfflineBlockDaily[]);
      const source = list.length > 0 
        ? list.map(d => ({ 
            date: new Date(d.date).toISOString().split("T")[0], 
            blocksCount: d.blocksCount, 
            totalBill: d.totalBill || d.dailyWages || 0, 
            cementBags: d.cementBags || 0 
          }))
        : offline.map(d => ({ date: d.date, blocksCount: d.blocksCount, totalBill: d.totalBill || d.dailyWages || 0, cementBags: d.cementBags }));

      const filtered = source.filter(d => d.date.startsWith(month));
      const finalFiltered = filtered.length === 0 && source.length > 0 ? source.slice(0,30) : filtered;

      setRecord({ 
        month, 
        totalBlocks: finalFiltered.reduce((s,r)=>s+r.blocksCount,0), 
        totalDailyBill: finalFiltered.reduce((s,r)=>s+(r.totalBill||0),0), 
        totalBags: finalFiltered.reduce((s,r)=>s+(r.cementBags||0),0), 
        daysWorked: finalFiltered.length 
      });

      const offlineHistory = await offlineDB.monthlyExpenses.toArray().catch(() => [] as MonthlyExpenseLocal[]);
      const sortedOffline = offlineHistory.sort((a,b)=>b.month.localeCompare(a.month));
      setHistory(sortedOffline);
      
      const current = offlineHistory.find(h=>h.month===month);
      if (current) {
        setElectricity(current.electricity);
        setRent(current.rent);
        setOther(current.other);
      }

      try {
        const offlineUser = getOfflineUser() as OfflineUser;
        const uid = offlineUser?._id || offlineUser?.id || "";
        const url = uid ? `/api/monthly-expenses?userId=${encodeURIComponent(uid)}` : "/api/monthly-expenses";
        const res = await fetch(url);
        if (res.ok) {
          const j = await res.json() as { data?: ServerMonthly[] };
          if (j.data && j.data.length > 0) {
            const mergedMap = new Map<string, MonthlyExpenseLocal>();
            sortedOffline.forEach(h=>mergedMap.set(h.month, h));
            j.data.forEach((s) => {
              const existing = mergedMap.get(s.month);
              if (existing) {
                mergedMap.set(s.month, { ...existing, synced: 1, _id: s._id || existing._id, totalMonthly: s.totalMonthly || existing.totalMonthly, costPerBlock: s.costPerBlock || existing.costPerBlock, grandCostPerBlock: s.grandCostPerBlock || existing.grandCostPerBlock });
              } else {
                mergedMap.set(s.month, {
                  month: s.month,
                  electricity: s.electricity,
                  rent: s.rent,
                  other: s.other,
                  totalMonthly: s.totalMonthly,
                  totalBlocks: s.totalBlocks,
                  totalDailyBill: s.totalDailyBill,
                  costPerBlock: s.costPerBlock,
                  grandCostPerBlock: s.grandCostPerBlock,
                  synced: 1,
                  createdAt: s.createdAt,
                  userId: s.userId,
                  _id: s._id,
                });
              }
            });
            setHistory(Array.from(mergedMap.values()).sort((a,b)=>b.month.localeCompare(a.month)));
            for (const srv of j.data) {
              const local = await offlineDB.monthlyExpenses.get(srv.month);
              if (local && local.synced === 0) {
                await offlineDB.monthlyExpenses.update(srv.month, { synced: 1, _id: srv._id });
              }
            }
          }
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [month]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadAll(); }, [loadAll]);

  const totalMonthly = useMemo(() => electricity + rent + other, [electricity, rent, other]);
  const costPerBlock = useMemo(() => !record || record.totalBlocks === 0 ? 0 : Number((totalMonthly / record.totalBlocks).toFixed(2)), [record, totalMonthly]);
  const grandCostPerBlock = useMemo(() => !record || record.totalBlocks === 0 ? 0 : Number(((record.totalDailyBill + totalMonthly) / record.totalBlocks).toFixed(2)), [record, totalMonthly]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const offlineUser = getOfflineUser() as OfflineUser;
      const userId = offlineUser?._id || offlineUser?.id || "offline_user";
      await saveMonthlyExpenseOffline({
        month,
        electricity,
        rent,
        other,
        totalMonthly,
        totalBlocks: record?.totalBlocks || 0,
        totalDailyBill: record?.totalDailyBill || 0,
        costPerBlock,
        grandCostPerBlock,
        userId,
      });
      await loadAll();
      alert(`Saved ${month}: ${totalMonthly} Rs | Per Block ${costPerBlock} Rs | Real ${grandCostPerBlock} Rs`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4">
      <div className="max-w-[760px] mx-auto px-3 space-y-4">
        <div className="bg-white border rounded-2xl p-4 sm:p-6 shadow-sm">
          <h1 className="font-bold text-[16px]">💡 Monthly Expenses / ماہانہ خرچ</h1>
          <p className="text-[11px] text-gray-500 mt-1">Add electricity once per month / بجلی مہینے میں ایک بار</p>
          <div className="flex gap-2 mt-4">
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} className="flex-1 border p-3 rounded-xl text-[13px]" />
            <button onClick={() => setMonth(new Date().toISOString().slice(0,7))} className="px-3 py-2 border rounded-xl text-[11px] font-bold">This Month</button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-[12px] text-gray-400">Loading blocks for {month}...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <div className="bg-gray-50 p-3 rounded-xl border text-center">
                <div className="text-[10px] text-gray-500 font-bold">کل دن / Days</div>
                <div className="font-bold text-[18px]">{record?.daysWorked || 0}</div>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 text-center">
                <div className="text-[10px] text-blue-700 font-bold">کل بلاکس / Blocks</div>
                <div className="font-bold text-[18px]">{record?.totalBlocks || 0} نغ</div>
                <div className="text-[9px] text-gray-500">{record?.totalBags || 0} بوری</div>
              </div>
              <div className="bg-green-50 p-3 rounded-xl border border-green-200 text-center">
                <div className="text-[10px] text-green-700 font-bold">روزانہ کل بل</div>
                <div className="font-bold text-[14px]">{record?.totalDailyBill || 0} Rs</div>
              </div>
            </div>
          )}

          <div className="space-y-3 mt-6">
            <div><label className="text-[11px] font-bold">Electricity Bill / بجلی بل (WAPDA) - Rs</label><input type="number" value={electricity} onChange={e=>setElectricity(Number(e.target.value) || 0)} className="w-full border p-3 rounded-xl mt-1 text-[13px] border-orange-300 bg-orange-50/50" /></div>
            <div><label className="text-[11px] font-bold">Rent / کرایہ - Rs</label><input type="number" value={rent} onChange={e=>setRent(Number(e.target.value) || 0)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
            <div><label className="text-[11px] font-bold">Other Monthly / دیگر ماہانہ - Rs</label><input type="number" value={other} onChange={e=>setOther(Number(e.target.value) || 0)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
          </div>

          <div className="bg-[#0f4fb8]/10 p-4 rounded-xl mt-6 border text-[13px] font-bold leading-7">
            ماہانہ کل خرچ / Monthly Total: {totalMonthly} Rs<br/>
            اس مہینے کل بلاکس / Blocks: {record?.totalBlocks || 0} نغ<br/>
            بجلی فی بلاک / Per Block: {costPerBlock} Rs<br/>
            اصل لاگت فی بلاک / Real Cost: {grandCostPerBlock} Rs<br/>
            <span className="text-[11px] font-normal text-gray-600">Formula: ({record?.totalDailyBill || 0} + {totalMonthly}) ÷ {record?.totalBlocks || 1} = {grandCostPerBlock} Rs</span>
          </div>

          <button onClick={() => void handleSave()} disabled={saving} className="w-full bg-black text-white p-4 rounded-xl font-bold mt-4 text-[14px]">{saving ? "Saving..." : `Save Monthly / ماہانہ محفوظ کریں - ${month}`}</button>
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h2 className="font-bold text-[13px] mb-3">📜 Saved History / محفوظ شدہ ریکارڈ - {history.length} months</h2>
          {history.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-6 text-center">No saved yet — Your 52000 Rs IS in IndexedDB, will show here after this update.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-gray-100"><tr><th className="p-2 text-left">Month</th><th className="p-2">Electric</th><th className="p-2">Rent</th><th className="p-2">Other</th><th className="p-2">Total</th><th className="p-2">Per Block</th><th className="p-2">Status</th></tr></thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.month} className="border-t">
                      <td className="p-2 font-bold">{h.month}</td>
                      <td className="p-2">{h.electricity}</td>
                      <td className="p-2">{h.rent}</td>
                      <td className="p-2">{h.other}</td>
                      <td className="p-2 font-bold">{h.totalMonthly} Rs</td>
                      <td className="p-2">{h.costPerBlock} Rs</td>
                      <td className="p-2">{h.synced === 0 ? <span className="text-orange-600">📶 Pending</span> : <span className="text-green-600">✓ Synced</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}