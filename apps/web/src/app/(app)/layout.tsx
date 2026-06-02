import { Toaster } from "@repo/ui/components/sonner";
import TopNav from "@/components/nav/top-nav";
import QueryProvider from "@/components/query-provider";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <TopNav />
      {children}
      <Toaster />
    </QueryProvider>
  );
}
