"use client";

import { useState } from "react";
import { cn } from "@repo/ui/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/ui/components/sheet";
import type { StoredEvent } from "@/lib/types/events";
import { formatTime } from "@/lib/utils/date";
import { useCalendarStore } from "@/lib/stores/calendar-store";
import {
  useDeleteEvent,
  useEvents,
  useToggleActionItem,
} from "@/lib/queries/events";
import ActionItemRow from "@/components/action-item-row";

export default function EventDetailSheet() {
  const { data: events = [] } = useEvents();
  const openEventId = useCalendarStore((s) => s.openEventId);
  const setOpenEventId = useCalendarStore((s) => s.setOpenEventId);
  const event = events.find((e) => e.id === openEventId) ?? null;

  return (
    <Sheet
      open={!!event}
      onOpenChange={(open) => {
        if (!open) setOpenEventId(null);
      }}
    >
      <SheetContent
        side="right"
        className="w-full bg-surface p-0 sm:max-w-md"
      >
        {event && (
          <EventDetailContent
            key={event.id}
            event={event}
            onClose={() => setOpenEventId(null)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EventDetailContent({
  event,
  onClose,
}: {
  event: StoredEvent;
  onClose: () => void;
}) {
  const toggleMut = useToggleActionItem();
  const deleteMut = useDeleteEvent();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = event.action_items;
  const date = new Date(event.start_time);
  const dayLabel = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeLabel = event.is_all_day
    ? "All day"
    : `${formatTime(event.start_time)}${event.end_time ? ` – ${formatTime(event.end_time)}` : ""}`;

  async function handleToggle(itemId: string, done: boolean) {
    setError(null);
    try {
      await toggleMut.mutateAsync({ itemId, done });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update item");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError(null);
    try {
      await deleteMut.mutateAsync(event.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event");
    }
  }

  const doneCount = items.filter((i) => i.done).length;
  const deleting = deleteMut.isPending;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-hairline px-6 pb-5 pt-6">
        <div className="text-eyebrow-accent">{dayLabel}</div>
        <div className="mt-1 font-mono text-[13px] text-ink-soft">
          {timeLabel}
        </div>
        <SheetTitle asChild>
          <h2 className="mt-3 text-title text-ink">{event.title}</h2>
        </SheetTitle>
        <SheetDescription className="sr-only">
          Event details for {event.title}
        </SheetDescription>
        {event.location && (
          <div className="mt-2 text-meta">{event.location}</div>
        )}
      </div>

      <div className="space-y-4 border-b border-hairline px-6 py-5">
        <Field label="Type">
          <span className="font-mono text-[11px] capitalize text-ink">
            {event.event_type}
          </span>
        </Field>
        {event.description && (
          <Field label="Notes">
            <p className="text-body text-ink-soft">{event.description}</p>
          </Field>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="text-eyebrow">Action items</div>
          {items.length > 0 && (
            <div className="font-mono text-[11px] text-ink-mute">
              {doneCount} / {items.length}
            </div>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-meta">No action items.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <ActionItemRow
                key={item.id}
                item={item}
                onToggle={() => handleToggle(item.id, !item.done)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-hairline bg-background px-6 py-3">
        {error && (
          <p className="mb-2 text-meta text-destructive">{error}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={cn(
              "inline-flex h-7 items-center justify-center rounded-sm border px-3 text-[11px] font-medium transition-colors",
              confirmDelete
                ? "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "border-hairline text-ink-mute hover:border-destructive hover:text-destructive",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {deleting
              ? "Deleting…"
              : confirmDelete
                ? "Confirm delete"
                : "Delete"}
          </button>
          <button
            type="button"
            onClick={confirmDelete && !deleting ? () => setConfirmDelete(false) : onClose}
            className="inline-flex h-7 items-center justify-center rounded-sm border border-hairline px-3 text-[11px] font-medium text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
          >
            {confirmDelete && !deleting ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-eyebrow">{label}</div>
      {children}
    </div>
  );
}
