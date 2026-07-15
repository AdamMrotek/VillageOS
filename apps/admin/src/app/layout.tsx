import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "VillageOS Admin",
  description: "Internal dashboards for VillageOS experiments and evals.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
