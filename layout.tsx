import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "وَصل | أقرب لمن تحب",
  description: "مساحة بسيطة لتبقى على تواصل مع من يهمّك، باستخدام بريدك الإلكتروني فقط.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "وَصل" },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }], apple: "/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#087a68", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
