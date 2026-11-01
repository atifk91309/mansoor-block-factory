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
    default: "Asad General Store - Mobile Accessories, Manyari, Cosmetics",
    template: "%s | Asad General Store",
  },
  description:
    "Asad General Store - Mobile accessories, manyari, cosmetics, general items. Fast billing, stock, profit, Udhar Khata, Wusool, Easypaisa. Offline-ready PWA.",
  applicationName: "Asad General Store",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Asad Store",
  },
  icons: {
    icon: [
      { url: "/logo.png", sizes: "32x32", type: "image/png" },
      { url: "/logo.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-circle-180.png", sizes: "180x180", type: "image/png" },
      { url: "/icon-circle-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-circle-180.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon-circle-180.png"],
  },
  openGraph: {
    title: "Asad General Store - اسد جنرل سٹور",
    description: "Mobile Accessories • Manyari • Cosmetics • Offline Ready",
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
      <body className="min-h-full flex flex-col bg-gray-50">
        <SWRegister />
        {children}
      </body>
    </html>
  );
}