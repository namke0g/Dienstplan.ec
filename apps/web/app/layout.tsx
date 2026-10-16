import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Dienstplan", description: "Dienstplanung mit Genehmigung durch PDL und Betriebsrat", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { themeColor: "#2563eb", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="de"><body>{children}</body></html>);
}
