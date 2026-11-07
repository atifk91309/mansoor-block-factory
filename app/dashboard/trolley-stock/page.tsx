"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { offlineDB, cleanupZeroTrolleyStock } from "@/lib/offline-db";
import { saveTrolleyOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";
import type { OfflineTrolleyEntry, OfflineTrolleyStock } from "@/lib/offline-db";
import type { TrolleyInput } from "@/lib/offline-sync";

const API_BASE = "/api/trolley-stock";
const FROZEN_RAIRI = 60;

function rnd(n: number): number { return Math.round(Number(n) || 0); }
function getPKDate(): string {
  const d = new Date(); d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 300);
  return d.toISOString().split("T")[0];
}

type EntryDisplay = OfflineTrolleyEntry & {
  rairiPerTrolley?: number;
  rairiInTrolley?: number;
  actualRairi?: number;
  totalUsed?: number;
  totalRairi?: number;
  perRairiRate?: number;
  trolleyPrice: number;
  localId: string;
  date: string;
  status: string;
  material: string;
  _id?: string;
};

function getRairiValue(en: EntryDisplay): number {
  return en.actualRairi ?? en.rairiPerTrolley ?? en.rairiInTrolley ?? en.totalRairi ?? FROZEN_RAIRI;
}

export default function TrolleyStockPage() {
  const [material, setMaterial] = useState("پن کرش");
  const [price, setPrice] = useState(13000);
  const [date, setDate] = useState(getPKDate());
  const [entries, setEntries] = useState<EntryDisplay[]>([]);
  const [stocks, setStocks] = useState<OfflineTrolleyStock[]>([]);
  const [saving, setSaving] = useState(false);
  const [closeLocalId, setCloseLocalId] = useState<string | null>(null);
  const [actualRairi, setActualRairi] = useState(0);

  const estimatedRate = useMemo(() => {
    return FROZEN_RAIRI > 0 ? Number((price / FROZEN_RAIRI).toFixed(2)) : 0;
  }, [price]);

  const getUserId = useCallback(async (): Promise<string> => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { user?: { id?: string; _id?: string } };
        if (data?.user?.id) return data.user.id;
        if (data?.user?._id) return data.user._id;
      }
    } catch {}
    const offlineUser = getOfflineUser() as { _id?: string; id?: string } | null;
    return offlineUser?._id || offlineUser?.id || "offline_user";
  }, []);

  const load = useCallback(async (): Promise<void> => {
    await cleanupZeroTrolleyStock().catch(()=>0);
    const eAll = await offlineDB.trolleyEntries.toArray().catch(() => [] as OfflineTrolleyEntry[]) as EntryDisplay[];
    const sAll = await offlineDB.trolleyStock.toArray().catch(() => [] as OfflineTrolleyStock[]);

    const filteredLocal = sAll.filter(s => (s.totalRairi || 0) > 0);
    setEntries(eAll.sort((a, b) => b.date.localeCompare(a.date)));
    setStocks(filteredLocal);

    try {
      const userId = await getUserId();
      const res = await fetch(`${API_BASE}?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      if (res.ok) {
        const j = await res.json() as { data?: EntryDisplay[]; stock?: OfflineTrolleyStock[]; entries?: EntryDisplay[] };
        const d = j.data || j.entries || [];
        if (d.length > 0) setEntries(d.sort((a, b) => b.date.localeCompare(a.date)));
        if (j.stock && j.stock.length > 0) {
          const filteredServer = j.stock.filter(s => (s.totalRairi || 0) > 0);
          setStocks(filteredServer);
        }
      }
    } catch {}
  }, [getUserId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleAdd(): Promise<void> {
    if (!material.trim() || price <= 0) {
      alert("میٹریل، قیمت چیک کریں");
      return;
    }
    setSaving(true);
    try {
      const userId = await getUserId();
      const localId = `trolley_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      
      const offlinePayload: TrolleyInput = {
        material: material.trim(),
        rairiPerTrolley: FROZEN_RAIRI,
        rairiInTrolley: FROZEN_RAIRI,
        quantity: 1,
        unit: "trolley",
        trolleyPrice: rnd(price),
        date,
        userId,
        localId,
        purpose: "factory",
      };

      await saveTrolleyOffline(offlinePayload);

      const apiPayload = {
        material: material.trim(),
        rairiInTrolley: FROZEN_RAIRI,
        rairiPerTrolley: FROZEN_RAIRI,
        totalRairi: FROZEN_RAIRI,
        quantity: 1,
        unit: "trolley",
        trolleyPrice: rnd(price),
        perRairiRate: Number((price / FROZEN_RAIRI).toFixed(2)),
        date,
        userId,
        localId,
        purpose: "factory",
      };

      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });
      if (res.ok) {
        await offlineDB.trolleyEntries.update(localId, { synced: 1 });
      }

      await load();
    } finally {
      setSaving(false);
    }
  }

  // ✅ NEW: DELETE
  async function handleDelete(en: EntryDisplay): Promise<void> {
    if ((en.totalUsed ?? 0) > 0) {
      alert(`Cannot delete - ${en.totalUsed} Rairi daily me use ho chuki hai. Pehle daily delete karo.`);
      return;
    }
    if (!confirm(`${en.material} ${en.trolleyPrice} wala OPEN stock delete karna hai?`)) return;
    
    // Offline delete
    await offlineDB.trolleyEntries.delete(en.localId).catch(()=>{});
    
    // Server delete
    try {
      const id = en._id || en.localId;
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) {
        alert(data.error || "Delete failed");
        await load();
        return;
      }
    } catch {}
    await load();
  }

  // ✅ NEW: EDIT
  async function handleEdit(en: EntryDisplay): Promise<void> {
    const newPriceStr = prompt(`Nayi Qeemat likho (Purani: ${en.trolleyPrice}):`, String(en.trolleyPrice));
    if (!newPriceStr) return;
    const newPrice = Number(newPriceStr);
    if (newPrice <= 0) { alert("Qeemat sahi likho"); return; }

    // Offline update
    const newRate = Number((newPrice / FROZEN_RAIRI).toFixed(2));
    await offlineDB.trolleyEntries.update(en.localId, { 
      trolleyPrice: rnd(newPrice), 
      perRairiRate: newRate 
    }).catch(()=>{});

    // Server update
    try {
      const id = en._id || en.localId;
      await fetch(`${API_BASE}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trolleyPrice: rnd(newPrice) })
      });
    } catch {}
    await load();
  }

  async function handleClose(localId: string): Promise<void> {
    if (actualRairi <= 0) { alert("اصل ریڑھی لکھیں"); return; }
    const userId = await getUserId();
    const res = await fetch(`${API_BASE}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ localId, actualRairi, actualQty: rnd(actualRairi), userId }),
    });
    if (res.ok) {
      const entry = entries.find((en) => en.localId === localId);
      if (entry) {
        const newRate = Number((entry.trolleyPrice / actualRairi).toFixed(2));
        const updateFields: Partial<OfflineTrolleyEntry> = {
          totalRairi: rnd(actualRairi),
          actualRairi: rnd(actualRairi),
          rairiPerTrolley: rnd(actualRairi),
          status: "CLOSED",
          perRairiRate: newRate,
        };
        await offlineDB.trolleyEntries.update(localId, updateFields);

        const normalized = entry.material.trim().toLowerCase();
        const stockRow = await offlineDB.trolleyStock.where("normalizedMaterial").equals(normalized).first();
        if (stockRow) {
          const allForMat = await offlineDB.trolleyEntries.where("normalizedMaterial").equals(normalized).toArray() as EntryDisplay[];
          let tR = 0; let tC = 0;
          for (const e of allForMat) {
            if (e.localId === localId) {
              tR += rnd(actualRairi);
              tC += rnd(actualRairi) * newRate;
            } else {
              const eff = e.actualRairi ?? e.rairiPerTrolley ?? FROZEN_RAIRI;
              const rem = Math.max(0, eff - (e.totalUsed ?? 0));
              if (rem <= 0) continue;
              tR += rem;
              tC += rem * (e.perRairiRate ?? 0);
            }
          }
          const avg = tR > 0 ? Number((tC / tR).toFixed(2)) : 0;
          await offlineDB.trolleyStock.update(stockRow.localId, {
            totalRairi: tR,
            totalCost: Math.round(tC),
            avgRate: avg,
            perRairiRate: avg,
          });
        }
      }
      setCloseLocalId(null); setActualRairi(0); 
      await load();
    } else {
      const txt = await res.text();
      alert(txt);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-3" dir="rtl">
      <div className="max-w-5xl mx-auto px-3 space-y-4">
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h1 className="font-bold text-[16px]">🚛 ٹرالی اسٹاک - اصل حساب</h1>
          <p className="text-[10px] text-gray-500 mt-1">اب 60 اندازہ، اصل 55/57/61 پر rate auto — {estimatedRate} روپے تخمینہ</p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="col-span-2">
              <label className="text-[11px] font-bold">میٹریل *</label>
              <input value={material} onChange={(e) => setMaterial(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" />
              <div className="flex gap-1 mt-2 flex-wrap">
                {["پن کرش", "ترکے کرش", "مانیرے کرش", "گھٹہ شگہ", "بجری", "ریت"].map((m) => (
                  <button key={m} onClick={() => setMaterial(m)} className={`px-2 py-1 rounded-lg text-[10px] border font-bold ${material === m ? "bg-black text-white" : "bg-gray-100"}`}>{m}</button>
                ))}
              </div>
            </div>
            <div><label className="text-[11px] font-bold">اندازاً ریڑھی (60)</label><input type="number" value={FROZEN_RAIRI} readOnly className="w-full border p-3 rounded-xl mt-1 text-[13px] font-bold bg-blue-50" /></div>
            <div><label className="text-[11px] font-bold">قیمت *</label><input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="w-full border p-3 rounded-xl mt-1 text-[13px] font-bold" /></div>
            <div><label className="text-[11px] font-bold">تاریخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
            <div className="bg-green-50 border border-green-200 p-3 rounded-xl"><div className="text-[10px] font-bold text-green-700">فی ریڑھی (تخمینہ 60)</div><div className="font-bold text-[18px]">{estimatedRate} روپے</div><div className="text-[9px] text-gray-500">{price} ÷ 60 = تخمینہ، بند پر {Number((price / 55).toFixed(2))} (55 پر)</div></div>
          </div>
          <button onClick={() => void handleAdd()} disabled={saving} className="w-full bg-black text-white p-4 rounded-xl font-bold mt-4">{saving ? "محفوظ..." : `شامل کریں ${material} ${FROZEN_RAIRI} ریڑھی @ ${estimatedRate} روپے`}</button>
        </div>
        <div className="bg-white border rounded-2xl p-4 shadow-sm"><h2 className="font-bold text-[13px] mb-3">📦 اسٹاک - {stocks.length}</h2>{stocks.length===0 ? <div className="text-[11px] text-gray-400 py-4 text-center">کوئی اسٹاک نہیں</div> : stocks.map((s) => (<div key={s.localId} className="border rounded-xl p-3 bg-gray-50 mb-2"><div className="font-bold text-[13px]">{s.material}</div><div className="text-[11px]">کل: <b>{s.totalRairi} ریڑھی</b> | لاگت: <b>{s.totalCost}</b> | اوسط: <b>{Number(s.perRairiRate || s.avgRate).toFixed(2)} Rs</b> {Number(s.perRairiRate || s.avgRate) > 300 ? "🔥 اصل" : ""}</div></div>))}</div>
        <div className="bg-white border rounded-2xl p-4 shadow-sm"><h2 className="font-bold text-[13px] mb-3">📋 تاریخ - {entries.length}</h2><div className="overflow-auto"><table className="w-full text-[11px]"><thead className="bg-gray-100"><tr><th className="p-2 text-right">تاریخ</th><th className="p-2 text-right">میٹریل</th><th className="p-2">تخمینہ</th><th className="p-2">اصل</th><th className="p-2">قیمت</th><th className="p-2">فی ریڑھی</th><th className="p-2">حالت</th><th className="p-2">عمل</th></tr></thead><tbody>{entries.map((en) => (<tr key={en.localId} className="border-t"><td className="p-2">{en.date.slice(0, 10)}</td><td className="p-2 font-bold">{en.material}</td><td className="p-2">{FROZEN_RAIRI}</td><td className="p-2 font-bold text-blue-600">{en.actualRairi ?? "-"}</td><td className="p-2">{en.trolleyPrice}</td><td className="p-2 font-bold text-green-700">{Number(en.perRairiRate || 0).toFixed(2)}</td><td className="p-2">{en.status === "OPEN" ? "🟡 OPEN" : "✅ CLOSED"}</td><td className="p-2">
          {en.status === "OPEN" ? (
            closeLocalId === en.localId ? (
              <div className="flex gap-1 flex-wrap">
                <input type="number" value={actualRairi || ""} onChange={(ev) => setActualRairi(Number(ev.target.value))} className="w-16 border p-1 rounded text-[10px]" placeholder="اصل 55" />
                <button onClick={() => void handleClose(en.localId)} className="bg-black text-white px-2 py-1 rounded text-[9px]">بند</button>
                <button onClick={() => setCloseLocalId(null)} className="border px-2 py-1 rounded text-[9px]">✕</button>
              </div>
            ) : (
              <div className="flex gap-1 flex-wrap">
                <button onClick={() => { setCloseLocalId(en.localId); setActualRairi(FROZEN_RAIRI); }} className="bg-blue-600 text-white px-2 py-1 rounded text-[9px]">Close</button>
                <button onClick={() => void handleEdit(en)} className="bg-yellow-500 text-white px-2 py-1 rounded text-[9px]">ترمیم</button>
                <button onClick={() => void handleDelete(en)} className="bg-red-600 text-white px-2 py-1 rounded text-[9px]">حذف</button>
              </div>
            )
          ) : ("OK")}
        </td></tr>))}</tbody></table></div></div>
      </div>
    </div>
  );
}