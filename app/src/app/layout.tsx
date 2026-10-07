import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "CCAI（仮称）",
  description: "二人のコミュニケーションを支える相談アプリ（開発中）",
  manifest: "/manifest.webmanifest",
  applicationName: "CCAI（仮称）",
  appleWebApp: { capable: true, title: "CCAI", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f6f62",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <main className="page">{children}</main>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
