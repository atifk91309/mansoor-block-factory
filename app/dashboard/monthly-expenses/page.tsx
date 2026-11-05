"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineBlockDaily, MonthlyExpenseLocal } from "@/lib/offline-db";
import { saveMonthlyExpenseOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";

const API_MONTHLY = "/api/monthly-expenses"; // ✅ FIX: folder monthly-expenses hai, monthly-expense nahi

type MonthlyRecord = {
  month: string;
  totalBlocks: number;
  totalDailyBill: number;
  totalMixCost: number;
  totalTrolleyCost: number;
  totalCementBags: number;
  totalBags: number;
  totalRairiUsed: number;
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
  mixMaterials?: { rairi?: number }[];
};

type OfflineUser = { _id?: string; id?: string } | null;
type ServerMonthly = MonthlyExpenseLocal & { _id?: string; totalTrolleyCost?: number; totalCementBags?: number; totalRairiUsed?: number };
type OfflineDailyExt = OfflineBlockDaily & { trolleyMixCost?: number; totalRairiUsed?: number };
type MonthlyExt = MonthlyExpenseLocal & { totalTrolleyCost?: number; totalCementBags?: number; totalRairiUsed?: number; _id?: string };

export default function MonthlyExpensePage() {
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0,7));
  const [electricity, setElectricity] = useState<number>(20000);
  const [rent, setRent] = useState<number>(30000);
  const [other, setOther] = useState<number>(2000);
  const [record, setRecord] = useState<MonthlyRecord | null>(null);
  const [history, setHistory] = useState<MonthlyExt[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      let list: BlockDailyDoc[] = [];
      try {
        const res = await fetch(`/api/block-daily`, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json() as { data?: BlockDailyDoc[] };
          list = j.data || [];
        }
      } catch {}
      const offline: OfflineDailyExt[] = await offlineDB.blockDaily.toArray().catch(() => [] as OfflineDailyExt[]);
      
      const source = list.length > 0 
        ? list.map(d => ({ 
            date: new Date(d.date).toISOString().split("T")[0], 
            blocksCount: d.blocksCount, 
            totalBill: d.totalBill || d.dailyWages || 0,
            mixCost: d.mixCost || 0,
            trolleyMixCost: d.trolleyMixCost || d.mixCost || 0,
            cementBags: d.cementBags || 0,
            totalRairiUsed: (d.mixMaterials || []).reduce((s, m) => s + (m.rairi || 0), 0),
          }))
        : offline.map(d => ({ 
            date: d.date, blocksCount: d.blocksCount, totalBill: d.totalBill || d.dailyWages || 0, 
            mixCost: d.mixCost || 0, trolleyMixCost: d.trolleyMixCost || d.mixCost || 0,
            cementBags: d.cementBags,
            totalRairiUsed: d.totalRairiUsed || (d.mixMaterials || []).reduce((s, m) => s + (m.rairi || 0), 0),
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
        totalRairiUsed: finalFiltered.reduce((s,r)=>s+(r.totalRairiUsed||0),0),
        daysWorked: finalFiltered.length 
      });

      const offlineHistory = await offlineDB.monthlyExpenses.toArray().catch(() => [] as MonthlyExpenseLocal[]) as MonthlyExt[];
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
        const url = uid ? `${API_MONTHLY}?userId=${encodeURIComponent(uid)}` : API_MONTHLY;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json() as { data?: ServerMonthly[] };
          const serverData = j.data || [];
          if (serverData.length > 0) {
            const mergedMap = new Map<string, MonthlyExt>();
            sortedOffline.forEach(h=>mergedMap.set(h.month, h));
            serverData.forEach((s) => {
              const existing = mergedMap.get(s.month);
              if (existing) {
                mergedMap.set(s.month, { 
                  ...existing, synced: 1, _id: s._id || existing._id, 
                  totalMonthly: s.totalMonthly || existing.totalMonthly, 
                  totalMixCost: s.totalMixCost || existing.totalMixCost, 
                  totalTrolleyCost: s.totalTrolleyCost || existing.totalTrolleyCost,
                  totalRairiUsed: s.totalRairiUsed || existing.totalRairiUsed,
                  costPerBlock: s.costPerBlock || existing.costPerBlock, 
                  grandCostPerBlock: s.grandCostPerBlock || existing.grandCostPerBlock,
                });
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
                  totalTrolleyCost: s.totalTrolleyCost || s.totalMixCost || 0,
                  totalCementBags: s.totalCementBags || 0,
                  totalRairiUsed: s.totalRairiUsed || 0,
                  costPerBlock: s.costPerBlock,
                  grandCostPerBlock: s.grandCostPerBlock,
                  trueCostPerBlock: s.grandCostPerBlock,
                  synced: 1,
                  createdAt: s.createdAt,
                  userId: s.userId,
                  _id: s._id,
                } as MonthlyExt);
              }
            });
            const merged = Array.from(mergedMap.values()).sort((a,b)=>b.month.localeCompare(a.month));
            setHistory(merged);
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
      const payloadLocal = {
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
        totalRairiUsed: record?.totalRairiUsed || 0,
        costPerBlock,
        grandCostPerBlock,
        trueCostPerBlock: grandCostPerBlock,
        userId,
      };

      const saved = await saveMonthlyExpenseOffline(payloadLocal);

      if (navigator.onLine) {
        try {
          const res = await fetch(API_MONTHLY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payloadLocal,
              localId: saved,
            }),
          });
          if (res.ok) {
            await offlineDB.monthlyExpenses.update(saved, { synced: 1 });
          }
        } catch {}
      }

      await loadAll();
      alert(`محفوظ ہو گیا ${month}: ماہانہ ${totalMonthly} روپے | مکس ${record?.totalMixCost||0} روپے | ${record?.totalRairiUsed||0} ریڑھی | فی بلاک ${costPerBlock} روپے | اصل ${grandCostPerBlock} روپے`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-2 sm:py-4" dir="rtl">
      <div className="max-w-[760px] mx-auto px-2 sm:px-3 space-y-3 sm:space-y-4">
        <div className="bg-white border rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-sm">
          <h1 className="font-bold text-[13px] sm:text-[16px]">💡 ماہانہ خرچہ - Group 2 Rairi 60/55 Lock</h1>
          <p className="text-[10px] sm:text-[11px] text-gray-500 mt-1">مکس خرچ (ریڑھی حساب) روزانہ پیداوار سے خود آئے گا - ٹرالی 60 ریڑھی</p>
          <div className="flex gap-2 mt-3 sm:mt-4">
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)} className="flex-1 border p-2.5 sm:p-3 rounded-xl text-[12px] sm:text-[13px]" />
            <button onClick={() => setMonth(new Date().toISOString().slice(0,7))} className="px-3 py-2 border rounded-xl text-[10px] sm:text-[11px] font-bold">اس مہینہ</button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-[12px] text-gray-400">لوڈ ہو رہا ہے {month}...</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-3 sm:mt-4">
              <div className="bg-gray-50 p-2.5 sm:p-3 rounded-xl border text-center">
                <div className="text-[9px] sm:text-[10px] text-gray-500 font-bold">کل دن</div>
                <div className="font-bold text-[15px] sm:text-[18px]">{record?.daysWorked || 0}</div>
              </div>
              <div className="bg-blue-50 p-2.5 sm:p-3 rounded-xl border border-blue-200 text-center">
                <div className="text-[9px] sm:text-[10px] text-blue-700 font-bold">کل بلاکس</div>
                <div className="font-bold text-[15px] sm:text-[18px]">{record?.totalBlocks || 0} نغ</div>
                <div className="text-[8px] sm:text-[9px] text-gray-500">{record?.totalBags || 0} بوری | {record?.totalRairiUsed || 0} ریڑھی</div>
              </div>
              <div className="bg-purple-50 p-2.5 sm:p-3 rounded-xl border border-purple-200 text-center">
                <div className="text-[9px] sm:text-[10px] text-purple-700 font-bold">مکس خرچ (ریڑھی)</div>
                <div className="font-bold text-[12px] sm:text-[14px]">{record?.totalMixCost || 0} روپے</div>
                <div className="text-[8px] sm:text-[9px] text-gray-500">ٹرالی {record?.totalTrolleyCost || 0} روپے</div>
              </div>
              <div className="bg-green-50 p-2.5 sm:p-3 rounded-xl border border-green-200 text-center">
                <div className="text-[9px] sm:text-[10px] text-green-700 font-bold">روزانہ کل بل</div>
                <div className="font-bold text-[12px] sm:text-[14px]">{record?.totalDailyBill || 0} روپے</div>
              </div>
            </div>
          )}

          <div className="space-y-2.5 sm:space-y-3 mt-4 sm:mt-6">
            <div><label className="text-[10px] sm:text-[11px] font-bold">بجلی بل (واپڈا) - روپے</label><input type="number" value={electricity} onChange={e=>setElectricity(Number(e.target.value) || 0)} className="w-full border p-2.5 sm:p-3 rounded-xl mt-1 text-[12px] sm:text-[13px] border-orange-300 bg-orange-50/50" /></div>
            <div><label className="text-[10px] sm:text-[11px] font-bold">کرایہ - روپے</label><input type="number" value={rent} onChange={e=>setRent(Number(e.target.value) || 0)} className="w-full border p-2.5 sm:p-3 rounded-xl mt-1 text-[12px] sm:text-[13px]" /></div>
            <div><label className="text-[10px] sm:text-[11px] font-bold">دیگر ماہانہ خرچہ - روپے</label><input type="number" value={other} onChange={e=>setOther(Number(e.target.value) || 0)} className="w-full border p-2.5 sm:p-3 rounded-xl mt-1 text-[12px] sm:text-[13px]" /></div>
          </div>

          <div className="bg-[#0f4fb8]/10 p-3 sm:p-4 rounded-xl mt-4 sm:mt-6 border text-[11px] sm:text-[13px] font-bold leading-6 sm:leading-7">
            ماہانہ کل خرچ: {totalMonthly} روپے (بجلی {electricity}+کرایہ {rent}+دیگر {other})<br/>
            مکس خرچ اس مہینے (ریڑھی): {record?.totalMixCost || 0} روپے | {record?.totalRairiUsed || 0} ریڑھی | ٹرالی: {record?.totalTrolleyCost || 0} روپے<br/>
            اس مہینے کل بلاکس: {record?.totalBlocks || 0} نغ | روزانہ بل: {record?.totalDailyBill || 0} روپے<br/>
            بجلی فی بلاک: {costPerBlock} روپے<br/>
            اصل لاگت فی بلاک: {grandCostPerBlock} روپے<br/>
            <span className="text-[9px] sm:text-[11px] font-normal text-gray-600">فارمولا: ({record?.totalDailyBill || 0} میں {record?.totalMixCost || 0} مکس شامل) + {totalMonthly} ÷ {record?.totalBlocks || 1} = {grandCostPerBlock} روپے</span>
          </div>

          <button onClick={() => void handleSave()} disabled={saving} className="w-full bg-black text-white p-3 sm:p-4 rounded-xl font-bold mt-3 sm:mt-4 text-[13px] sm:text-[14px]">{saving ? "محفوظ ہو رہا ہے..." : `ماہانہ محفوظ کریں - ${month}`}</button>
        </div>

        <div className="bg-white border rounded-xl sm:rounded-2xl p-2.5 sm:p-4 shadow-sm">
          <h2 className="font-bold text-[11px] sm:text-[13px] mb-2 sm:mb-3">📜 محفوظ شدہ ریکارڈ - {history.length} مہینے</h2>
          {history.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-6 text-center">ابھی کوئی ریکارڈ نہیں - {month} کا ڈیٹا محفوظ کریں</div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="sm:hidden space-y-2">
                {history.map(h => (
                  <div key={h.month} className="border rounded-xl p-2.5 bg-gray-50 text-[10px]">
                    <div className="flex justify-between font-bold"><span>{h.month}</span><span className={h.synced===0 ? "text-orange-600" : "text-green-600"}>{h.synced===0 ? "📶 زیر التواء" : "✓ ہم آہنگ"}</span></div>
                    <div className="grid grid-cols-3 gap-1 mt-1.5">
                      <div>بجلی: {h.electricity}</div><div>کرایہ: {h.rent}</div><div className="text-purple-600 font-bold">مکس: {h.totalMixCost||0}</div>
                      <div>ریڑھی: {h.totalRairiUsed||0}</div><div>ٹرالی: {h.totalTrolleyCost||h.totalMixCost||0}</div><div>روزانہ: {h.totalDailyBill}</div>
                    </div>
                    <div className="flex gap-2 mt-1 font-bold"><span>کل: {h.totalMonthly} Rs</span><span>فی: {h.costPerBlock} Rs</span><span className="text-blue-600">اصل: {h.grandCostPerBlock} Rs</span></div>
                  </div>
                ))}
              </div>
              {/* Desktop Table View */}
              <div className="hidden sm:block overflow-x-auto rounded-lg border">
                <table className="w-full text-[10px] sm:text-[11px]">
                  <thead className="bg-gray-100"><tr><th className="p-2 text-right">مہینہ</th><th className="p-2">بجلی</th><th className="p-2">کرایہ</th><th className="p-2">مکس خرچ</th><th className="p-2">ریڑھی</th><th className="p-2">ٹرالی</th><th className="p-2">روزانہ بل</th><th className="p-2">کل</th><th className="p-2">فی بلاک</th><th className="p-2">اصل</th><th className="p-2">حالت</th></tr></thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.month} className="border-t">
                        <td className="p-2 font-bold">{h.month}</td>
                        <td className="p-2">{h.electricity}</td>
                        <td className="p-2">{h.rent}</td>
                        <td className="p-2 font-bold text-purple-600">{h.totalMixCost || 0}</td>
                        <td className="p-2">{h.totalRairiUsed || 0}</td>
                        <td className="p-2">{h.totalTrolleyCost || h.totalMixCost || 0}</td>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}