"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@repo/ui/components/button";
import PageLayout from "@/components/page-layout";
import ProviderEventCard from "@/components/provider-event-card";
import {
  useDeleteProviderEvent,
  useMyProviderEvents,
  useProviderEventAction,
  type ProviderEventAction,
} from "@/lib/queries/provider-events";
import { useMyProvider } from "@/lib/queries/providers";
import type { StoredProviderEvent } from "@/lib/types/provider-events";

const ACTION_DONE: Record<ProviderEventAction, string> = {
  publish: "Event published — parents can now see it.",
  unpublish: "Event moved back to drafts.",
  cancel: "Event cancelled.",
};

export default function ProviderEventsPage() {
  const { data: profile, isLoading: profileLoading } = useMyProvider();
  const { data: events, isLoading, isError } = useMyProviderEvents();

  // Events hang off the public provider page, so it has to exist first.
  const needsProfile = !profileLoading && profile === null;

  return (
    <PageLayout
      title="My events"
      action={
        needsProfile ? null : (
          <Link href="/provider/events/new" className={buttonVariants()}>
            New event
          </Link>
        )
      }
    >
      {needsProfile ? (
        <p className="text-sm text-ink-soft">
          Set up{" "}
          <Link
            href="/provider"
            className="text-primary underline underline-offset-4"
          >
            your provider page
          </Link>{" "}
          first — your events are shown on it.
        </p>
      ) : (
        <>
          {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
          {isError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t load your events. Please try again.
            </p>
          )}
          {events && events.length === 0 && (
            <p className="text-sm text-ink-soft">
              No events yet. Create one, then publish it to show it on your
              provider page.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {events?.map((event) => (
              <ProviderEventCard
                key={event.id}
                event={event}
                showStatus
                footer={<EventActions event={event} />}
              />
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}

function EventActions({ event }: { event: StoredProviderEvent }) {
  const action = useProviderEventAction();
  const remove = useDeleteProviderEvent();
  // Cancelling can't be undone, so it takes a second click to confirm.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const busy = action.isPending || remove.isPending;

  function run(name: ProviderEventAction) {
    action.mutate(
      { id: event.id, action: name },
      { onSuccess: () => toast.success(ACTION_DONE[name]) },
    );
  }

  if (event.status === "cancelled") return null;

  if (confirmingCancel) {
    return (
      <>
        <span className="self-center text-sm text-ink-soft">
          Cancel this event? This can&apos;t be undone.
        </span>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() => run("cancel")}
        >
          Yes, cancel event
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirmingCancel(false)}
        >
          Keep event
        </Button>
      </>
    );
  }

  return (
    <>
      <Link
        href={`/provider/events/${event.id}`}
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        Edit
      </Link>
      {event.status === "draft" ? (
        <>
          <Button size="sm" disabled={busy} onClick={() => run("publish")}>
            Publish
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              remove.mutate(event.id, {
                onSuccess: () => toast.success("Draft deleted."),
              })
            }
          >
            Delete
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run("unpublish")}
          >
            Unpublish
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmingCancel(true)}
          >
            Cancel event
          </Button>
        </>
      )}
    </>
  );
}
