import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SWRegister from "./sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Mansoor Block Factory - MOHAL - Blocks, Crush, Rait - Ismaila",
    template: "%s | MOHAL Block Factory",
  },
  description:
    "Mansoor Block Factory - Mohal - Blocks, Crush, Rait, Cement. Daily Production, Sales, Stock, Profit, Udhar Khata, Yearly Reports. Offline-ready PWA - Ismaila, Swabi.",
  applicationName: "MOHAL - Mansoor Block Factory",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MOHAL Blocks",
  },
  icons: {
    icon: [
      { url: "/icon-circle-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-circle-512.png", sizes: "512x512", type: "image/png" },
      { url: "/logo.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/icon-circle-180.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/icon-circle-512.png"],
  },
  openGraph: {
    title: "Mansoor Block Factory - منصور بلاک فیکٹری - MOHAL - Ismaila",
    description: "Blocks • Crush • Rait • Cement • Daily Production 78 Bori • Yearly 8386 Blocks • Offline Ready • No Play Store",
    type: "website",
    images: ["/icon-circle-512.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f4fb8",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <link rel="apple-touch-icon" href="/icon-circle-180.png" />
      </head>
      <body className="min-h-full flex flex-col bg-gray-50">
        <SWRegister />
        {children}
      </body>
    </html>
  );
}