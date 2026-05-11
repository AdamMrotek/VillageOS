import Link from "next/link";
import { apiServer } from "@/lib/api-server";
import type { StoredEvent } from "@/lib/types/events";
import WeekGrid from "@/components/week-grid";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await apiServer<StoredEvent[]>("/api/events");

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-title text-ink">Events</h1>
        <Link
          href="/events/new"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          New event
        </Link>
      </div>

      <WeekGrid events={events} />
    </main>
  );
}
