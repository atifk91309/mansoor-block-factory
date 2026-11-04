"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { offlineDB } from "@/lib/offline-db";
import { saveTrolleyOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";
import type { OfflineTrolleyEntry, OfflineTrolleyStock } from "@/lib/offline-db";
import type { TrolleyInput } from "@/lib/offline-sync";

const API_BASE = "/api/trolley-stock"; // ✅ tumhara folder yahi hai

function rnd(n: number): number { return Math.round(Number(n) || 0); }
function getPKDate(): string {
  const d = new Date(); d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 300);
  return d.toISOString().split("T")[0];
}

export default function TrolleyStockPage() {
  const [material, setMaterial] = useState("پن کرش");
  const [rairi, setRairi] = useState(60);
  const [price, setPrice] = useState(13000);
  const [date, setDate] = useState(getPKDate());
  const [entries, setEntries] = useState<OfflineTrolleyEntry[]>([]);
  const [stocks, setStocks] = useState<OfflineTrolleyStock[]>([]);
  const [saving, setSaving] = useState(false);
  const [closeLocalId, setCloseLocalId] = useState<string | null>(null);
  const [actualRairi, setActualRairi] = useState(0);

  const rate = useMemo(() => (rairi > 0 ? Number((price / rairi).toFixed(2)) : 0), [rairi, price]);

  const getUserId = useCallback(async (): Promise<string> => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { user?: { id?: string; _id?: string } };
        if (data?.user?.id) return data.user.id;
        if (data?.user?._id) return data.user._id;
      }
    } catch {}
    const offlineUser = getOfflineUser() as { _id?: string; id?: string } | null;
    return offlineUser?._id || offlineUser?.id || "offline_user";
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const eAll = await offlineDB.trolleyEntries.toArray().catch(() => [] as OfflineTrolleyEntry[]);
    const sAll = await offlineDB.trolleyStock.toArray().catch(() => [] as OfflineTrolleyStock[]);
    setEntries(eAll.sort((a, b) => b.date.localeCompare(a.date)));
    setStocks(sAll);
    try {
      const userId = await getUserId();
      const res = await fetch(`${API_BASE}?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { data?: OfflineTrolleyEntry[]; stock?: OfflineTrolleyStock[] };
        if (j.data && j.data.length > 0) setEntries(j.data.sort((a, b) => b.date.localeCompare(a.date)));
        if (j.stock && j.stock.length > 0) setStocks(j.stock);
      }
    } catch {}
  }, [getUserId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function handleAdd(): Promise<void> {
    if (!material.trim() || rairi <= 0 || price <= 0) {
      alert("میٹریل، اندازاً ریڑھی، قیمت چیک کریں");
      return;
    }
    setSaving(true);
    try {
      const userId = await getUserId();
      const localId = `trolley_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const payload: TrolleyInput = {
        material: material.trim(),
        rairiInTrolley: rnd(rairi),
        trolleyPrice: rnd(price),
        date,
        userId,
        localId,
        purpose: "factory",
      };

      await saveTrolleyOffline(payload);

      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await offlineDB.trolleyEntries.update(localId, { synced: 1 });
        console.log("✅ MongoDB saved at", API_BASE);
      } else {
        console.error("❌ Mongo fail", await res.text());
      }

      await load();
      alert(`شامل ہو گیا ${material} - ${rairi} ریڑھی`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClose(localId: string): Promise<void> {
    if (actualRairi <= 0) { alert("اصل ریڑھی لکھیں"); return; }
    const userId = await getUserId();
    const res = await fetch(`${API_BASE}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ localId, actualRairi, userId }),
    });
    if (res.ok) {
      const entry = entries.find((e) => e.localId === localId);
      if (entry) {
        const newRate = Number((entry.trolleyPrice / actualRairi).toFixed(2));
        await offlineDB.trolleyEntries.update(localId, { actualRairi, status: "CLOSED", perRairiRate: newRate });
      }
      setCloseLocalId(null); setActualRairi(0); await load();
    } else alert(await res.text());
  }

  return (
    <div className="min-h-screen bg-gray-50 py-3" dir="rtl">
      <div className="max-w-[900px] mx-auto px-3 space-y-4">
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h1 className="font-bold text-[16px]">🚛 ٹرالی / ٹرک اسٹاک - 60 / 800 ریڑھی</h1>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="col-span-2">
              <label className="text-[11px] font-bold">میٹریل *</label>
              <input value={material} onChange={(e) => setMaterial(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" />
              <div className="flex gap-1 mt-2 flex-wrap">
                {["پن کرش", "ترکے کرش", "منیرے کرش", "گھٹہ شگہ", "بجری", "ریت"].map((m) => (
                  <button key={m} onClick={() => { setMaterial(m); setRairi(m.includes("گھٹہ") || m.includes("بجری") ? 55 : 60); }} className={`px-2 py-1 rounded-lg text-[10px] border font-bold ${material === m ? "bg-black text-white" : "bg-gray-100"}`}>{m}</button>
                ))}
              </div>
            </div>
            <div><label className="text-[11px] font-bold">ریڑھی *</label><input type="number" value={rairi} onChange={(e) => setRairi(Number(e.target.value))} className="w-full border p-3 rounded-xl mt-1 text-[13px] font-bold bg-blue-50" /></div>
            <div><label className="text-[11px] font-bold">قیمت *</label><input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="w-full border p-3 rounded-xl mt-1 text-[13px] font-bold" /></div>
            <div><label className="text-[11px] font-bold">تاریخ</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
            <div className="bg-blue-50 border p-3 rounded-xl"><div className="text-[10px] font-bold text-blue-700">فی ریڑھی</div><div className="font-bold text-[18px]">{rate} روپے</div></div>
          </div>
          <button onClick={() => void handleAdd()} disabled={saving} className="w-full bg-black text-white p-4 rounded-xl font-bold mt-4">{saving ? "محفوظ..." : `شامل کریں ${material} ${rairi} ریڑھی`}</button>
        </div>
        <div className="bg-white border rounded-2xl p-4 shadow-sm"><h2 className="font-bold text-[13px] mb-3">📦 اسٹاک - {stocks.length}</h2>{stocks.map((s) => (<div key={s.localId} className="border rounded-xl p-3 bg-gray-50 mb-2"><div className="font-bold text-[13px]">{s.material}</div><div className="text-[11px]">کل: <b>{s.totalRairi} ریڑھی</b> | لاگت: <b>{s.totalCost}</b> | اوسط: <b>{s.avgRate}</b></div></div>))}</div>
        <div className="bg-white border rounded-2xl p-4 shadow-sm"><h2 className="font-bold text-[13px] mb-3">📋 تاریخ - {entries.length}</h2><div className="overflow-auto"><table className="w-full text-[11px]"><thead className="bg-gray-100"><tr><th className="p-2 text-right">تاریخ</th><th className="p-2 text-right">میٹریل</th><th className="p-2">تخمینہ</th><th className="p-2">اصل</th><th className="p-2">قیمت</th><th className="p-2">فی ریڑھی</th><th className="p-2">حالت</th><th className="p-2">عمل</th></tr></thead><tbody>{entries.map((en) => (<tr key={en.localId} className="border-t"><td className="p-2">{en.date.slice(0, 10)}</td><td className="p-2 font-bold">{en.material}</td><td className="p-2">{en.rairiInTrolley}</td><td className="p-2">{en.actualRairi ?? "-"}</td><td className="p-2">{en.trolleyPrice}</td><td className="p-2 font-bold">{en.perRairiRate}</td><td className="p-2">{en.status}</td><td className="p-2">{en.status === "OPEN" ? (closeLocalId === en.localId ? (<div className="flex gap-1"><input type="number" value={actualRairi || ""} onChange={(e) => setActualRairi(Number(e.target.value))} className="w-20 border p-1 rounded text-[10px]" /><button onClick={() => void handleClose(en.localId)} className="bg-black text-white px-2 py-1 rounded text-[9px]">بند</button><button onClick={() => setCloseLocalId(null)} className="border px-2 py-1 rounded text-[9px]">✕</button></div>) : (<button onClick={() => { setCloseLocalId(en.localId); setActualRairi(en.rairiInTrolley); }} className="bg-blue-600 text-white px-2 py-1 rounded text-[9px]">Close</button>)) : ("OK")}</td></tr>))}</tbody></table></div></div>
      </div>
    </div>
  );
}