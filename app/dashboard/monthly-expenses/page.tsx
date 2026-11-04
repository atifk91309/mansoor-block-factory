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
  totalMixCost: number;
  totalTrolleyCost: number;
  totalCementBags: number;
  totalBags: number;
  daysWorked: number;
};

type BlockDailyDoc = {
  date: string;
  blocksCount: number;
  totalBill?: number;
  dailyWages?: number;
  mixCost?: number;
  trolleyMixCost?: number;
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
        const res = await fetch(`/api/block-daily`); // No batch filter
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
            mixCost: d.mixCost || 0,
            trolleyMixCost: d.trolleyMixCost || d.mixCost || 0,
            cementBags: d.cementBags || 0,
          }))
        : offline.map(d => ({ 
            date: d.date, blocksCount: d.blocksCount, totalBill: d.totalBill || d.dailyWages || 0, 
            mixCost: d.mixCost || 0, trolleyMixCost: (d as unknown as { trolleyMixCost?: number }).trolleyMixCost || d.mixCost || 0,
            cementBags: d.cementBags,
          }));

      const filtered = source.filter(d => d.date.startsWith(month));
      const finalFiltered = filtered.length === 0 && source.length > 0 ? source.slice(0,30) : filtered;

      setRecord({ 
        month,
        totalBlocks: finalFiltered.reduce((s,r)=>s+r.blocksCount,0), 
        totalDailyBill: finalFiltered.reduce((s,r)=>s+(r.totalBill||0),0),
        totalMixCost: finalFiltered.reduce((s,r)=>s+(r.mixCost||0),0),
        totalTrolleyCost: finalFiltered.reduce((s,r)=>s+(r.trolleyMixCost||0),0),
        totalBags: finalFiltered.reduce((s,r)=>s+(r.cementBags||0),0),
        totalCementBags: finalFiltered.reduce((s,r)=>s+(r.cementBags||0),0),
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
      } else {
        setElectricity(20000);
        setRent(30000);
        setOther(2000);
      }

      try {
        const offlineUser = getOfflineUser() as OfflineUser;
        const uid = offlineUser?._id || offlineUser?.id || "";
        // FIX: /api/monthly-expenses -> /api/monthly-expense No Batch
        const url = uid ? `/api/monthly-expense?userId=${encodeURIComponent(uid)}` : `/api/monthly-expense`;
        const res = await fetch(url);
        if (res.ok) {
          const j = await res.json() as { data?: ServerMonthly[] };
          const serverData = j.data || [];
          if (serverData.length > 0) {
            const mergedMap = new Map<string, MonthlyExpenseLocal>();
            sortedOffline.forEach(h=>mergedMap.set(h.month, h));
            serverData.forEach((s) => {
              const existing = mergedMap.get(s.month);
              if (existing) {
                mergedMap.set(s.month, { 
                  ...existing, synced: 1, _id: s._id || existing._id, 
                  totalMonthly: s.totalMonthly || existing.totalMonthly, 
                  totalMixCost: s.totalMixCost || existing.totalMixCost, 
                  costPerBlock: s.costPerBlock || existing.costPerBlock, 
                  grandCostPerBlock: s.grandCostPerBlock || existing.grandCostPerBlock,
                } as MonthlyExpenseLocal);
              } else {
                mergedMap.set(s.month, {
                  month: s.month,
                  electricity: s.electricity,
                  rent: s.rent,
                  other: s.other,
                  totalMonthly: s.totalMonthly,
                  totalBlocks: s.totalBlocks,
                  totalDailyBill: s.totalDailyBill,
                  totalMixCost: s.totalMixCost || 0,
                  costPerBlock: s.costPerBlock,
                  grandCostPerBlock: s.grandCostPerBlock,
                  synced: 1,
                  createdAt: s.createdAt,
                  userId: s.userId,
                  _id: s._id,
                } as unknown as MonthlyExpenseLocal);
              }
            });
            const merged = Array.from(mergedMap.values()).sort((a,b)=>b.month.localeCompare(a.month));
            setHistory(merged);
            // Update current month inputs from server if offline not found
            if (!current) {
              const serverCurrent = merged.find(h=>h.month===month);
              if (serverCurrent) {
                setElectricity(serverCurrent.electricity);
                setRent(serverCurrent.rent);
                setOther(serverCurrent.other);
              }
            }
          }
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { 
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [loadAll]);

  const totalMonthly = useMemo(() => electricity + rent + other, [electricity, rent, other]);
  const costPerBlock = useMemo(() => !record || record.totalBlocks === 0 ? 0 : Number((totalMonthly / record.totalBlocks).toFixed(2)), [record, totalMonthly]);
  const grandCostPerBlock = useMemo(() => !record || record.totalBlocks === 0 ? 0 : Number(((record.totalDailyBill + totalMonthly) / record.totalBlocks).toFixed(2)), [record, totalMonthly]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const offlineUser = getOfflineUser() as OfflineUser;
      const userId = offlineUser?._id || offlineUser?.id || "offline_user";
      const saved = await saveMonthlyExpenseOffline({
        month,
        electricity,
        rent,
        other,
        totalMonthly,
        totalBlocks: record?.totalBlocks || 0,
        totalDailyBill: record?.totalDailyBill || 0,
        totalMixCost: record?.totalMixCost || 0,
        totalTrolleyCost: record?.totalTrolleyCost || 0,
        totalCementBags: record?.totalCementBags || 0,
        costPerBlock,
        grandCostPerBlock,
        trueCostPerBlock: grandCostPerBlock,
        userId,
      } as unknown as Parameters<typeof saveMonthlyExpenseOffline>[0]);

      // Sync to server No Batch
      if (navigator.onLine) {
        try {
          const res = await fetch("/api/monthly-expense", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              month,
              electricity,
              rent,
              other,
              totalMonthly,
              totalBlocks: record?.totalBlocks || 0,
              totalDailyBill: record?.totalDailyBill || 0,
              totalMixCost: record?.totalMixCost || 0,
              totalCementBags: record?.totalCementBags || 0,
              totalTrolleyCost: record?.totalTrolleyCost || 0,
              costPerBlock,
              grandCostPerBlock,
              trueCostPerBlock: grandCostPerBlock,
              userId,
              localId: saved,
            }),
          });
          if (res.ok) {
            await offlineDB.monthlyExpenses.update(saved, { synced: 1 });
          }
        } catch {}
      }

      await loadAll();
      alert(`محفوظ ہو گیا ${month}: ماہانہ ${totalMonthly} روپے | مکس ${record?.totalMixCost||0} روپے | فی بلاک ${costPerBlock} روپے | اصل لاگت ${grandCostPerBlock} روپے`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4" dir="rtl">
      <div className="max-w-[760px] mx-auto px-3 space-y-4">
        <div className="bg-white border rounded-2xl p-4 sm:p-6 shadow-sm">
          <h1 className="font-bold text-[16px]">💡 ماہانہ خرچہ - No Batch</h1>
          <p className="text-[11px] text-gray-500 mt-1">مکس خرچ (ریڑھی حساب سے) روزانہ پیداوار سے خود آئے گا - بجلی مہینے میں ایک بار</p>
          <div className="flex gap-2 mt-4">
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} className="flex-1 border p-3 rounded-xl text-[13px]" />
            <button onClick={() => setMonth(new Date().toISOString().slice(0,7))} className="px-3 py-2 border rounded-xl text-[11px] font-bold">اس مہینہ</button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-[12px] text-gray-400">لوڈ ہو رہا ہے {month}...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div className="bg-gray-50 p-3 rounded-xl border text-center">
                <div className="text-[10px] text-gray-500 font-bold">کل دن</div>
                <div className="font-bold text-[18px]">{record?.daysWorked || 0}</div>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200 text-center">
                <div className="text-[10px] text-blue-700 font-bold">کل بلاکس</div>
                <div className="font-bold text-[18px]">{record?.totalBlocks || 0} نغ</div>
                <div className="text-[9px] text-gray-500">{record?.totalBags || 0} بوری</div>
              </div>
              <div className="bg-purple-50 p-3 rounded-xl border border-purple-200 text-center">
                <div className="text-[10px] text-purple-700 font-bold">مکس خرچ (ریڑھی)</div>
                <div className="font-bold text-[14px]">{record?.totalMixCost || 0} روپے</div>
                <div className="text-[9px] text-gray-500">ٹرالی {record?.totalTrolleyCost || 0} روپے</div>
              </div>
              <div className="bg-green-50 p-3 rounded-xl border border-green-200 text-center">
                <div className="text-[10px] text-green-700 font-bold">روزانہ کل بل</div>
                <div className="font-bold text-[14px]">{record?.totalDailyBill || 0} روپے</div>
              </div>
            </div>
          )}

          <div className="space-y-3 mt-6">
            <div><label className="text-[11px] font-bold">بجلی بل (واپڈا) - روپے</label><input type="number" value={electricity} onChange={e=>setElectricity(Number(e.target.value) || 0)} className="w-full border p-3 rounded-xl mt-1 text-[13px] border-orange-300 bg-orange-50/50" /></div>
            <div><label className="text-[11px] font-bold">کرایہ - روپے</label><input type="number" value={rent} onChange={e=>setRent(Number(e.target.value) || 0)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
            <div><label className="text-[11px] font-bold">دیگر ماہانہ خرچہ - روپے</label><input type="number" value={other} onChange={e=>setOther(Number(e.target.value) || 0)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
          </div>

          <div className="bg-[#0f4fb8]/10 p-4 rounded-xl mt-6 border text-[13px] font-bold leading-7">
            ماہانہ کل خرچ: {totalMonthly} روپے (بجلی {electricity}+کرایہ {rent}+دیگر {other})<br/>
            مکس خرچ اس مہینے (ریڑھی حساب): {record?.totalMixCost || 0} روپے | ٹرالی: {record?.totalTrolleyCost || 0} روپے<br/>
            اس مہینے کل بلاکس: {record?.totalBlocks || 0} نغ | روزانہ بل: {record?.totalDailyBill || 0} روپے<br/>
            بجلی فی بلاک: {costPerBlock} روپے<br/>
            اصل لاگت فی بلاک: {grandCostPerBlock} روپے<br/>
            <span className="text-[11px] font-normal text-gray-600">فارمولا: ({record?.totalDailyBill || 0} میں {record?.totalMixCost || 0} مکس شامل) + {totalMonthly} ÷ {record?.totalBlocks || 1} = {grandCostPerBlock} روپے</span>
          </div>

          <button onClick={() => void handleSave()} disabled={saving} className="w-full bg-black text-white p-4 rounded-xl font-bold mt-4 text-[14px]">{saving ? "محفوظ ہو رہا ہے..." : `ماہانہ محفوظ کریں - ${month}`}</button>
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h2 className="font-bold text-[13px] mb-3">📜 محفوظ شدہ ریکارڈ - {history.length} مہینے</h2>
          {history.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-6 text-center">ابھی کوئی ریکارڈ نہیں - {month} کا ڈیٹا محفوظ کریں</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-gray-100"><tr><th className="p-2 text-right">مہینہ</th><th className="p-2">بجلی</th><th className="p-2">کرایہ</th><th className="p-2">مکس خرچ</th><th className="p-2">ٹرالی</th><th className="p-2">روزانہ بل</th><th className="p-2">کل</th><th className="p-2">فی بلاک</th><th className="p-2">اصل</th><th className="p-2">حالت</th></tr></thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.month} className="border-t">
                      <td className="p-2 font-bold">{h.month}</td>
                      <td className="p-2">{h.electricity}</td>
                      <td className="p-2">{h.rent}</td>
                      <td className="p-2 font-bold text-purple-600">{h.totalMixCost || 0}</td>
                      <td className="p-2">{(h as unknown as { totalTrolleyCost?: number }).totalTrolleyCost || h.totalMixCost || 0}</td>
                      <td className="p-2">{h.totalDailyBill}</td>
                      <td className="p-2 font-bold">{h.totalMonthly} روپے</td>
                      <td className="p-2">{h.costPerBlock} روپے</td>
                      <td className="p-2 font-bold text-blue-600">{h.grandCostPerBlock} روپے</td>
                      <td className="p-2">{h.synced === 0 ? <span className="text-orange-600">📶 زیر التواء</span> : <span className="text-green-600">✓ ہم آہنگ</span>}</td>
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