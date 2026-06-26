import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VillageOS Admin",
  description: "Internal dashboards for VillageOS experiments.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
