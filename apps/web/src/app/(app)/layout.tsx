import { Toaster } from "@repo/ui/components/sonner";
import BottomNav from "@/components/nav/bottom-nav";
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
      <div className="pb-16 md:pb-0">{children}</div>
      <BottomNav />
      <Toaster />
    </QueryProvider>
  );
}
