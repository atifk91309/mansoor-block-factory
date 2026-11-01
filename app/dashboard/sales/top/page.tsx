"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type TopItem = { _id: string; productId?: string; category?: string; totalQty: number; totalSale: number; totalProfit: number; count: number };
type TopFilter = "today" | "weekly" | "monthly" | "yearly" | "all";
type Category = "all" | "block" | "khaka" | "crush" | "bajri" | "rait" | "cement";

function fmt(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return Math.round(v).toLocaleString();
}

export default function TopPage() {
  const [filter, setFilter] = useState<TopFilter>("monthly");
  const [category, setCategory] = useState<Category>("all");
  const [top, setTop] = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/sales/top?filter=${filter}&category=${category}`)
      .then((r) => r.json() as Promise<{ top: TopItem[] }>)
      .then((d) => setTop(d.top || []))
      .catch(() => setTop([]))
      .finally(() => setLoading(false));
  }, [filter, category]);

  return (
    <div className="p-2 sm:p-4 max-w-4xl mx-auto min-h-screen bg-gray-50">
      <div className="flex justify-between items-center mb-3">
        <div>
          <h1 className="font-bold text-[16px] sm:text-[18px]">🔥 Mansoor Top Selling - Ismaila</h1>
          <p className="text-[10px] text-gray-500 capitalize">{filter} • {category} • {top.length} items • Factory</p>
        </div>
        <Link href="/dashboard/sales" className="text-[10px] bg-white border px-3 py-1.5 rounded-full font-bold">← POS</Link>
      </div>

      <div className="flex gap-1.5 mb-2 overflow-x-auto">
        {(["today", "weekly", "monthly", "yearly", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold capitalize ${filter === f ? "bg-black text-white" : "bg-white border"}`}>{f}</button>
        ))}
      </div>
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {(["all", "block", "khaka", "crush", "bajri", "rait", "cement"] as const).map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold capitalize ${category === c ? "bg-green-600 text-white" : "bg-white border"}`}>
            {c === "block" ? "🧱 Block" : c === "khaka" ? "🪨 Khaka" : c === "crush" ? "🏗️ Crush" : c === "bajri" ? "🏜️ Bajri" : c === "rait" ? "🏖️ Rait" : c === "cement" ? "🏗️ Cement" : "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[11px] text-center py-10">Loading top blocks...</p>
      ) : top.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center"><p className="text-[12px] text-gray-400">No sales {filter} {category} • Ismaila Factory</p></div>
      ) : (
        <>
          <div className="grid gap-2 sm:hidden">
            {top.map((p, i) => (
              <div key={p._id} className="bg-white border rounded-xl p-3 flex justify-between">
                <div className="flex gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-yellow-400" : i === 1 ? "bg-gray-300" : i === 2 ? "bg-orange-300" : "bg-gray-100 border"}`}>{i + 1}</span>
                  <div><p className="font-bold text-[12px]">{p._id}</p><p className="text-[9px] text-gray-500">{p.category} • {p.count} bills • {fmt(p.totalQty)} {p.category === "block" ? "blocks" : "trolly"}</p></div>
                </div>
                <div className="text-right"><p className="font-bold text-[12px] text-green-700">Rs.{fmt(p.totalSale)}</p><p className="text-[9px]">+{fmt(p.totalProfit)} profit</p></div>
              </div>
            ))}
          </div>
          <div className="hidden sm:block bg-white border rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-[10px] font-bold text-gray-500"><div className="col-span-1">#</div><div className="col-span-5">Product - Mansoor Factory</div><div className="col-span-2 text-center">Qty</div><div className="col-span-2 text-right">Sale</div><div className="col-span-2 text-right">Profit</div></div>
            {top.map((p, i) => (
              <div key={p._id} className="grid grid-cols-12 px-3 py-2.5 border-t text-[12px] hover:bg-gray-50">
                <div className="col-span-1"><span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-yellow-400" : i === 1 ? "bg-gray-300" : i === 2 ? "bg-orange-300" : "bg-gray-100 border"}`}>{i + 1}</span></div>
                <div className="col-span-5 font-bold truncate">{p._id} <span className="text-[9px] text-gray-400">({p.category})</span></div>
                <div className="col-span-2 text-center">{fmt(p.totalQty)} • {p.count} bills</div>
                <div className="col-span-2 text-right font-bold text-green-700">Rs.{fmt(p.totalSale)}</div>
                <div className="col-span-2 text-right">+{fmt(p.totalProfit)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
            <div className="bg-white border p-3 rounded-xl text-center"><p className="text-gray-400">Total Sale</p><p className="font-bold text-[13px] text-green-700">Rs.{fmt(top.reduce((a, b) => a + b.totalSale, 0))}</p></div>
            <div className="bg-white border p-3 rounded-xl text-center"><p className="text-gray-400">Total Profit</p><p className="font-bold text-[13px]">Rs.{fmt(top.reduce((a, b) => a + b.totalProfit, 0))}</p></div>
            <div className="bg-white border p-3 rounded-xl text-center"><p className="text-gray-400">Total Bills</p><p className="font-bold text-[13px]">{top.reduce((a, b) => a + b.count, 0)}</p></div>
          </div>
        </>
      )}
    </div>
  );
}