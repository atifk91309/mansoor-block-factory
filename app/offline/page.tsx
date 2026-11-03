import Image from "next/image";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-[#eff6ff] p-6 text-center">
      <Image 
        src="/icon-circle-512.png" 
        unoptimized 
        alt="Mansoor Block Factory - MOHAL" 
        width={80} 
        height={80} 
        className="w-20 h-20 rounded-full border-2 border-[#0f4fb8] mb-4 bg-white" 
      />
      <h1 className="text-xl font-bold">🧱 Mansoor Block Factory</h1>
      <p className="text-[#0f4fb8] text-sm font-bold">منصور بلاک فیکٹری - محل</p>
      <p className="text-gray-600 text-sm font-medium">Blocks • Crush • Rait • Cement • Ismaila</p>
      <p className="text-gray-500 text-[12px] mt-3 font-bold">You are offline. Your data is safe.</p>
      <p className="text-[11px] text-gray-400 mt-1">Daily Production, Sales, Stock & Khata work offline • Auto-sync when online</p>
      <p className="text-[11px] text-gray-400 mt-1">Yearly: 8386 Blocks / 78 Bori • Production tracking offline • No expiry</p>
      
      <div className="flex gap-2 mt-5 flex-wrap justify-center">
        <Link href="/" className="bg-[#0f4fb8] text-white px-4 py-2 rounded-xl text-sm font-bold">Home</Link>
        <Link href="/dashboard" className="bg-white border px-4 py-2 rounded-xl text-sm">Dashboard</Link>
        <Link href="/dashboard/block-daily" className="bg-white border px-4 py-2 rounded-xl text-sm">Daily Prod</Link>
        <Link href="/dashboard/sales" className="bg-white border px-4 py-2 rounded-xl text-sm">POS Sale</Link>
      </div>
      
      <p className="text-[10px] text-gray-400 mt-6">
        Mansoor Block Factory - MOHAL • Offline V3 • منصور بلاک فیکٹری • Ismaila, Swabi • No Play Protect Warning
      </p>
    </div>
  );
}