"use client";
import { useState, useEffect, useMemo } from "react";
import { offlineDB } from "@/lib/offline-db";
import { saveTrolleyOffline, closeTrolleyOffline } from "@/lib/offline-sync";
import { getOfflineUser } from "@/lib/offline-auth";
import type { OfflineTrolleyEntry, OfflineTrolleyStock } from "@/lib/offline-db";

type OfflineUser = { _id?: string; id?: string } | null;

function rnd(n: number): number { return Math.round(Number(n) || 0); }
function getPKDate(): string {
  const d = new Date(); d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 300);
  return d.toISOString().split("T")[0];
}

export default function TrolleyStockPage() {
  const [material, setMaterial] = useState("Ghata Shaga");
  const [rairi, setRairi] = useState(55);
  const [price, setPrice] = useState(66000);
  const [date, setDate] = useState(getPKDate());
  const [entries, setEntries] = useState<OfflineTrolleyEntry[]>([]);
  const [stocks, setStocks] = useState<OfflineTrolleyStock[]>([]);
  const [saving, setSaving] = useState(false);
  const [closeId, setCloseId] = useState<string>("");
  const [actualRairi, setActualRairi] = useState(0);

  const rate = useMemo(() => rairi > 0 ? Number((price / rairi).toFixed(2)) : 0, [rairi, price]);

  async function load(): Promise<void> {
    const e = await offlineDB.trolleyEntries.orderBy("date").reverse().toArray().catch(() => []);
    const s = await offlineDB.trolleyStock.toArray().catch(() => []);
    setEntries(e);
    setStocks(s);
    try {
      const res = await fetch("/api/trolley-stock");
      if (res.ok) {
        const j = await res.json() as { data?: OfflineTrolleyEntry[], stock?: OfflineTrolleyStock[] };
        if (j.data) setEntries(j.data.sort((a,b)=>b.date.localeCompare(a.date)) as OfflineTrolleyEntry[]);
        if (j.stock) setStocks(j.stock as OfflineTrolleyStock[]);
      }
    } catch {}
  }

  useEffect(() => { 
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function getUserId(): Promise<string> {
    try { const res = await fetch("/api/auth/session"); if (res.ok) { const d = await res.json() as { user?: { id?: string, _id?: string } }; if (d?.user?.id) return d.user.id; if (d?.user?._id) return d.user._id; } } catch {}
    const u = getOfflineUser() as OfflineUser; return u?._id || u?.id || "offline_user";
  }

  async function handleAdd(): Promise<void> {
    if (!material.trim() || rairi <=0 || price <=0) { alert("Check material, rairi, price"); return; }
    setSaving(true);
    try {
      const userId = await getUserId();
      const localId = await saveTrolleyOffline({ material: material.trim(), rairiInTrolley: rnd(rairi), trolleyPrice: rnd(price), date, userId });
      if (navigator.onLine) {
        try {
          const res = await fetch("/api/trolley-stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ material, rairiInTrolley: rairi, trolleyPrice: price, date, localId, userId }) });
          if (res.ok) await offlineDB.trolleyEntries.update(localId, { synced: 1 });
        } catch {}
      }
      await load();
      alert(`Added ${material} - ${rairi} Rairi @ ${rate} Rs = ${price} Rs`);
    } finally { setSaving(false); }
  }

  async function handleClose(): Promise<void> {
    if (!closeId || actualRairi <=0) { alert("Select trolley + actual rairi"); return; }
    const userId = await getUserId();
    await closeTrolleyOffline({ localId: closeId, actualRairi: rnd(actualRairi), userId });
    if (navigator.onLine) {
      try { await fetch("/api/trolley-stock/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localId: closeId, actualRairi, userId }) }); } catch {}
    }
    setCloseId(""); setActualRairi(0);
    await load();
  }

  const openEntries = entries.filter(e => e.status === "OPEN");

  return (
    <div className="min-h-screen bg-gray-50 py-3">
      <div className="max-w-[900px] mx-auto px-3 space-y-4">
        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h1 className="font-bold text-[16px]">🚛 Trolley Stock / ٹرالی اسٹاک</h1>
          <p className="text-[11px] text-gray-500 mt-1">Driver says 55 Rairi, actual 58? Add then close with actual to auto-correct rate.</p>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="col-span-2">
              <label className="text-[11px] font-bold">Material / میٹریل (Ghata Shaga, Ghata, etc)</label>
              <input value={material} onChange={e=>setMaterial(e.target.value)} placeholder="Ghata Shaga" className="w-full border p-3 rounded-xl mt-1 text-[13px]" />
              <div className="flex gap-1 mt-2 flex-wrap">
                {["Ghata Shaga", "Ghata", "Shaga", "Bajri", "Rait", "Crush"].map(m => (
                  <button key={m} onClick={()=>setMaterial(m)} className={`px-2 py-1 rounded-lg text-[10px] border font-bold ${material===m ? "bg-black text-white" : "bg-gray-100"}`}>{m}</button>
                ))}
              </div>
            </div>
            <div><label className="text-[11px] font-bold">Est Rairi / اندازاً ریڑھی</label><input type="number" value={rairi} onChange={e=>setRairi(Number(e.target.value))} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
            <div><label className="text-[11px] font-bold">Trolley Price / قیمت - Rs</label><input type="number" value={price} onChange={e=>setPrice(Number(e.target.value))} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
            <div><label className="text-[11px] font-bold">Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-[13px]" /></div>
            <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl flex flex-col justify-center">
              <div className="text-[10px] font-bold text-blue-700">Per Rairi Rate</div>
              <div className="font-bold text-[18px]">{rate} Rs</div>
              <div className="text-[9px] text-gray-500">{price} ÷ {rairi}</div>
            </div>
          </div>

          <button onClick={()=>void handleAdd()} disabled={saving} className="w-full bg-black text-white p-4 rounded-xl font-bold mt-4 text-[14px]">{saving ? "Saving..." : `Add Trolley - ${material} ${rairi}R @ ${rate}Rs`}</button>
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h2 className="font-bold text-[13px] mb-3">📦 Current Stock / موجودہ اسٹاک - Weighted Avg</h2>
          {stocks.length===0 ? <div className="text-[11px] text-gray-400 py-4 text-center">No stock yet</div> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {stocks.map(s => (
                <div key={s.localId} className="border rounded-xl p-3 bg-gray-50">
                  <div className="font-bold text-[13px]">{s.material}</div>
                  <div className="text-[11px] mt-1">Total: <b>{s.totalRairi} Rairi</b> | Cost: <b>{s.totalCost} Rs</b></div>
                  <div className="text-[12px] mt-1 font-bold text-blue-600">Avg Rate: {s.avgRate} Rs / Rairi</div>
                  <div className="text-[9px] text-gray-500">{s.normalizedMaterial} | {s.synced===0 ? "📶 Pending" : "✓ Synced"}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded-2xl p-4 shadow-sm">
          <h2 className="font-bold text-[13px] mb-3">📋 Trolley History / ٹرالی ہسٹری - {entries.length}</h2>
          
          <div className="bg-orange-50 border border-orange-200 p-3 rounded-xl mb-4">
            <div className="font-bold text-[11px]">Close Trolley with Actual Rairi / اصل ریڑھی</div>
            <div className="flex gap-2 mt-2">
              <select value={closeId} onChange={e=>setCloseId(e.target.value)} className="flex-1 border p-2 rounded-lg text-[11px] bg-white">
                <option value="">Select OPEN trolley</option>
                {openEntries.map(en => <option key={en.localId} value={en.localId}>{en.material} - {en.rairiInTrolley}R est - {en.date} - {en.localId.slice(-5)}</option>)}
              </select>
              <input type="number" value={actualRairi || ""} onChange={e=>setActualRairi(Number(e.target.value))} placeholder="Actual Rairi 58" className="w-[110px] border p-2 rounded-lg text-[11px]" />
              <button onClick={()=>void handleClose()} className="px-3 bg-orange-600 text-white rounded-lg text-[11px] font-bold">Close</button>
            </div>
            <div className="text-[9px] text-gray-600 mt-1">Example: Est 55 → Actual 58 = +3 Rairi added to stock, rate 1200 → 1137 Rs</div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-100"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Material</th><th className="p-2">Est</th><th className="p-2">Actual</th><th className="p-2">Price</th><th className="p-2">Rate</th><th className="p-2">Used</th><th className="p-2">Status</th></tr></thead>
              <tbody>
                {entries.map(en => (
                  <tr key={en.localId} className="border-t">
                    <td className="p-2">{en.date.slice(0,10)}</td>
                    <td className="p-2 font-bold">{en.material}</td>
                    <td className="p-2">{en.rairiInTrolley}</td>
                    <td className="p-2 font-bold text-orange-600">{en.actualRairi || "-"}</td>
                    <td className="p-2">{en.trolleyPrice} Rs</td>
                    <td className="p-2 font-bold">{en.perRairiRate} Rs</td>
                    <td className="p-2">{en.totalUsed}</td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${en.status==="OPEN" ? "bg-green-100 text-green-700" : "bg-gray-200"}`}>{en.status}</span></td>
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