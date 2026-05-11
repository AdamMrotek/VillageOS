import Link from "next/link";
import { apiServer } from "@/lib/api-server";
import type { StoredEvent } from "@/lib/types/events";
import EventCard from "@/components/event-card";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await apiServer<StoredEvent[]>("/api/events");

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <Link
          href="/events/new"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          New event
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No events yet.{" "}
          <Link href="/events/new" className="underline underline-offset-4">
            Create your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id}>
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
