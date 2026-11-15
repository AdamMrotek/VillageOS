"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@repo/ui/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/ui/components/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import type { ReservedEventInfo, StoredEvent } from "@/lib/types/events";
import { describeChanges } from "@/lib/utils/event-changes";
import { downloadIcs, openGoogleCalendar } from "@/lib/utils/calendar-export";
import { formatTime } from "@/lib/utils/date";
import { CALENDAR_LOCALE } from "@/lib/config/calendar";
import { useCalendarStore } from "@/lib/stores/calendar-store";
import {
  useDeleteEvent,
  useEvents,
  useToggleActionItem,
} from "@/lib/queries/events";
import {
  useCancelReservation,
  useMarkReservationSeen,
} from "@/lib/queries/provider-events";
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
        {event &&
          (event.reservation ? (
            <ReservedEventContent
              key={event.id}
              event={event}
              reservation={event.reservation}
              onClose={() => setOpenEventId(null)}
            />
          ) : (
            <EventDetailContent
              key={event.id}
              event={event}
              onClose={() => setOpenEventId(null)}
            />
          ))}
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
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);

  const items = event.action_items;
  const date = new Date(event.start_time);
  const dayLabel = date.toLocaleDateString(CALENDAR_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeLabel = event.is_all_day
    ? "All day"
    : `${formatTime(event.start_time)}${event.end_time ? ` – ${formatTime(event.end_time)}` : ""}`;

  // Failures surface as a toast via the mutation cache (query-provider).
  function handleToggle(itemId: string, done: boolean) {
    toggleMut.mutate({ itemId, done });
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteMut.mutate(event.id, { onSuccess: onClose });
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
        <div className="mb-2">
          <Popover open={calendarMenuOpen} onOpenChange={setCalendarMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 items-center justify-center rounded-sm border border-hairline px-3 text-[11px] font-medium text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
              >
                Add to calendar
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-1">
              <button
                type="button"
                onClick={() => {
                  openGoogleCalendar(event);
                  setCalendarMenuOpen(false);
                }}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[12px] text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
              >
                Google Calendar
              </button>
              <button
                type="button"
                onClick={() => {
                  downloadIcs(event);
                  setCalendarMenuOpen(false);
                }}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[12px] text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
              >
                Download .ics
              </button>
            </PopoverContent>
          </Popover>
        </div>
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

const sheetButton =
  "inline-flex h-7 items-center justify-center rounded-sm border px-3 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

/** A provider's event the parent reserved. Read-only: the provider owns the
 *  details, the parent can only give the spot back. */
function ReservedEventContent({
  event,
  reservation,
  onClose,
}: {
  event: StoredEvent;
  reservation: ReservedEventInfo;
  onClose: () => void;
}) {
  const cancelMut = useCancelReservation();
  const { mutate: markSeen } = useMarkReservationSeen();
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Worked out once, when the sheet opens. Opening also acknowledges the
  // change, which clears `updated` on the next fetch — the explanation has to
  // outlive that for as long as the sheet stays open.
  const [changes] = useState(() =>
    reservation.updated && reservation.previous
      ? describeChanges(reservation.previous, {
          ...event,
          status: reservation.cancelled ? "cancelled" : "published",
        })
      : [],
  );
  const [wasUpdated] = useState(reservation.updated);
  useEffect(() => {
    if (wasUpdated) markSeen(event.id);
  }, [wasUpdated, markSeen, event.id]);

  const date = new Date(event.start_time);
  const dayLabel = date.toLocaleDateString(CALENDAR_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeLabel = event.is_all_day
    ? "All day"
    : `${formatTime(event.start_time)}${event.end_time ? ` – ${formatTime(event.end_time)}` : ""}`;
  const cancelling = cancelMut.isPending;

  function handleCancel() {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    cancelMut.mutate(event.id, { onSuccess: onClose });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-hairline px-6 pb-5 pt-6">
        <div className="text-eyebrow-accent">{dayLabel}</div>
        <div className="mt-1 font-mono text-[13px] text-ink-soft">
          {timeLabel}
        </div>
        <SheetTitle asChild>
          <h2
            className={cn(
              "mt-3 text-title text-ink",
              reservation.cancelled && "line-through decoration-ink-mute",
            )}
          >
            {event.title}
          </h2>
        </SheetTitle>
        <SheetDescription className="sr-only">
          Event details for {event.title}
        </SheetDescription>
        {event.location && (
          <div className="mt-2 text-meta">{event.location}</div>
        )}
      </div>

      {(reservation.cancelled || changes.length > 0) && (
        <div
          role="status"
          className={cn(
            "border-b border-hairline px-6 py-4 text-body",
            reservation.cancelled
              ? "bg-destructive/10 text-destructive"
              : "bg-accent-soft text-ink",
          )}
        >
          <div className="text-eyebrow">
            {reservation.cancelled ? "Cancelled" : "Updated by the organiser"}
          </div>
          {changes.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">The organiser cancelled this event.</p>
          )}
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Field label="Organiser">
          <Link
            href={`/discover/${reservation.provider_id}`}
            onClick={onClose}
            className="text-body text-primary underline underline-offset-4"
          >
            {reservation.provider_name ?? "View organiser"}
          </Link>
        </Field>
        <Field label="Your reservation">
          <span className="text-body text-ink">
            {reservation.spots} {reservation.spots === 1 ? "spot" : "spots"}
          </span>
        </Field>
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

      <div className="border-t border-hairline bg-background px-6 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className={cn(
              sheetButton,
              confirmCancel
                ? "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "border-hairline text-ink-mute hover:border-destructive hover:text-destructive",
            )}
          >
            {cancelling
              ? "Cancelling…"
              : confirmCancel
                ? reservation.cancelled
                  ? "Confirm remove"
                  : "Confirm — give up my spot"
                : reservation.cancelled
                  ? "Remove from calendar"
                  : "Cancel reservation"}
          </button>
          <button
            type="button"
            onClick={
              confirmCancel && !cancelling
                ? () => setConfirmCancel(false)
                : onClose
            }
            className={cn(
              sheetButton,
              "border-hairline text-ink-soft hover:bg-surface-alt hover:text-ink",
            )}
          >
            {confirmCancel && !cancelling ? "Keep it" : "Close"}
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
