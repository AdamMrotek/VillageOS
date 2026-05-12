import Link from "next/link";
import { apiServer } from "@/lib/api-server";
import type { StoredEvent } from "@/lib/types/events";
import WeekGrid from "@/components/week-grid";
import PageLayout from "@/components/page-layout";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await apiServer<StoredEvent[]>("/api/events");

  return (
    <PageLayout
      title="Events"
      action={
        <Link
          href="/events/new"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          New event
        </Link>
      }
    >
      <WeekGrid events={events} />
    </PageLayout>
  );
}
