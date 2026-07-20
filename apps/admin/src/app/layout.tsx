import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@repo/ui/components/sonner";
import QueryProvider from "@repo/ui/custom_components/query-provider";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "VillageOS Admin",
  description: "Internal dashboard for VillageOS extraction evals.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <Nav />
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
