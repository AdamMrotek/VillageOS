"use client";

import { useRouter } from "next/navigation";
import { use } from "react";
import { toast } from "sonner";
import PageLayout from "@/components/page-layout";
import { EventStatusBadge } from "@/components/provider-event-card";
import ProviderEventForm from "@/components/provider-event-form";
import {
  useMyProviderEvents,
  useUpdateProviderEvent,
} from "@/lib/queries/provider-events";

export default function EditProviderEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const router = useRouter();
  // The provider's own list is small and already cached from the list page,
  // so the edit view reads from it rather than needing a single-event endpoint.
  const { data: events, isLoading, isError } = useMyProviderEvents();
  const update = useUpdateProviderEvent();
  const event = events?.find((e) => e.id === eventId);

  return (
    <PageLayout
      title="Edit event"
      backHref="/provider/events"
      backLabel="My events"
      action={event ? <EventStatusBadge status={event.status} /> : null}
    >
      {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
      {isError && (
        <p className="text-sm text-destructive">
          Couldn&apos;t load this event. Please try again.
        </p>
      )}
      {events && !event && (
        <p className="text-sm text-destructive">Event not found.</p>
      )}
      {event?.status === "cancelled" && (
        <p className="text-sm text-ink-soft">
          This event is cancelled and can no longer be edited.
        </p>
      )}
      {event && event.status !== "cancelled" && (
        <ProviderEventForm
          key={event.id}
          initial={event}
          submitLabel="Save changes"
          pending={update.isPending}
          onCancel={() => router.push("/provider/events")}
          onSubmit={(input) =>
            update.mutate(
              { id: event.id, event: input },
              {
                onSuccess: () => {
                  toast.success("Event saved.");
                  router.push("/provider/events");
                },
              },
            )
          }
        />
      )}
    </PageLayout>
  );
}
