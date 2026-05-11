"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@repo/ui/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@repo/ui/components/sheet";
import { apiClient } from "@/lib/api-client";
import type { ActionItem, StoredEvent } from "@/lib/types/events";
import { formatTime } from "@/lib/utils/date";

export default function EventDetailSheet({
  event,
  onClose,
}: {
  event: StoredEvent | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={!!event}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full bg-surface p-0 sm:max-w-md"
      >
        {event && <EventDetailContent key={event.id} event={event} onClose={onClose} />}
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
  const router = useRouter();
  const [items, setItems] = useState<ActionItem[]>(event.action_items);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const date = new Date(event.start_time);
  const dayLabel = date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeLabel = event.is_all_day
    ? "All day"
    : `${formatTime(event.start_time)}${event.end_time ? ` – ${formatTime(event.end_time)}` : ""}`;

  async function toggleItem(item: ActionItem) {
    const next = !item.done;
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, done: next } : i)),
    );
    setError(null);
    try {
      await apiClient(`/api/action_items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: next }),
      });
    } catch (err) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)),
      );
      setError(err instanceof Error ? err.message : "Could not update item");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await apiClient(`/api/events/${event.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event");
      setDeleting(false);
    }
  }

  const doneCount = items.filter((i) => i.done).length;

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
              <ActionRow key={item.id} item={item} onToggle={() => toggleItem(item)} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-hairline bg-background px-6 py-4">
        {error && (
          <p className="mb-3 text-body text-destructive">{error}</p>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={cn(
            "inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-body font-medium transition-colors",
            confirmDelete
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "border border-hairline bg-surface text-ink-soft hover:border-destructive hover:text-destructive",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {deleting
            ? "Deleting…"
            : confirmDelete
              ? "Confirm delete"
              : "Delete event"}
        </button>
        {confirmDelete && !deleting && (
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="mt-2 w-full text-center text-meta underline-offset-4 hover:underline"
          >
            Cancel
          </button>
        )}
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

function ActionRow({
  item,
  onToggle,
}: {
  item: ActionItem;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        "rounded-md border border-hairline bg-surface p-3 transition-colors",
        item.urgent && !item.done && "border-l-2 border-l-warm",
        item.done && "opacity-60",
      )}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={item.done}
          onChange={onToggle}
          className="mt-0.5 size-4 accent-accent"
        />
        <span className="flex-1">
          <span
            className={cn(
              "block text-body text-ink",
              item.done && "line-through",
            )}
          >
            {item.description}
          </span>
          <span className="mt-1 flex items-center gap-2 text-meta">
            {item.cost_estimate_gbp != null && (
              <span className="font-mono text-ink-mute">
                £{item.cost_estimate_gbp.toFixed(0)}
              </span>
            )}
            {item.urgent && !item.done && (
              <span className="rounded-sm bg-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-surface">
                Urgent
              </span>
            )}
          </span>
        </span>
      </label>
    </li>
  );
}
