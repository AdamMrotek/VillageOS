"use client";

import { useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Checkbox } from "@repo/ui/components/checkbox";
import { DatePicker } from "@repo/ui/components/date-picker";
import {
  EVENT_FIELD_LIMITS,
  EVENT_TYPES,
  type ActionItemInput,
  type EventType,
  type ParentEvent,
} from "@/lib/types/events";

// "active" is the editable form, "loading" a submit in flight (everything
// disabled, button reads "Creating…"), "disabled" fully inert.
export type EventFormVariant = "active" | "loading" | "disabled";

type EventFormProps = {
  variant: EventFormVariant;
  // The extracted draft to pre-fill from, or null for manual entry. Field
  // state initializes from this once — remount with a fresh `key` to load a
  // new draft.
  initial: ParentEvent | null;
  // Which fields the model populated → drives the sage dots.
  extracted: Partial<Record<keyof ParentEvent, boolean>>;
  // True when showing an extracted draft (vs manual entry) — gates the dot
  // legend and the missing-end-time flag.
  fromExtraction: boolean;
  onSubmit: (event: ParentEvent) => void;
  onDiscard: () => void;
};

// Split an ISO timestamp into the `date` (YYYY-MM-DD) and `time` (HH:mm) parts
// the native <input type="date"> / <input type="time"> controls expect, in the
// viewer's local zone. Empty parts for a null/invalid input.
function isoToParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Recombine a date + time part back into an ISO string. No date → null. When
// allDay (or the time was left blank) we anchor to midnight local.
function partsToIso(date: string, time: string, allDay: boolean): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${allDay || !time ? "00:00" : time}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Small flag glyph for the urgent badge / toggle. `filled` paints the pennant
// solid (urgent state); otherwise it's an outline.
function FlagIcon({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 15V4a1 1 0 0 1 1-1h12l-2.5 4L17 11H5" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

// Sage dot marking a field the model read from the source. No score — just
// "this came from what you pasted, glance at it."
function ExtractedDot() {
  return (
    <span
      title="Read from your source"
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
    />
  );
}

function FieldLabel({
  children,
  extracted,
  htmlFor,
}: {
  children: React.ReactNode;
  extracted?: boolean;
  htmlFor?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="text-eyebrow">
        {children}
      </label>
      {extracted && <ExtractedDot />}
    </span>
  );
}

const inputClass =
  "flex h-9 w-full rounded-md border border-hairline bg-surface px-3 py-1 text-body text-ink shadow-sm placeholder:text-ink-mute/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// One editable action item: a card with the description on top and a cost
// pill + urgent toggle below. Urgent items get a warm wash and gold left
// accent. `onChange` takes a partial patch; `onRemove` drops the item.
function ActionItemCard({
  item,
  onChange,
  onRemove,
}: {
  item: ActionItemInput;
  onChange: (patch: Partial<ActionItemInput>) => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={`rounded-lg border p-3 transition-colors ${
        item.urgent
          ? "border-l-4 border-l-warm border-warm/30 bg-warm-surface/40"
          : "border-hairline bg-surface"
      }`}
    >
      <div className="flex pb-2 items-center justify-between gap-3">
        <input
          value={item.description}
          onChange={(e) => onChange({ description: e.target.value })}
          required
          // The API strips whitespace and rejects empty descriptions — block
          // whitespace-only values `required` alone would let through.
          pattern=".*\S.*"
          title="Action item description cannot be empty"
          aria-label="Action item description"
          placeholder="Return the signed consent form"
          className="min-w-0 flex-1 bg-transparent text-body font-medium text-ink placeholder:text-ink-mute/60 focus-visible:outline-none"
        />
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onRemove}
            className="text-meta hover:text-destructive"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Meta row: cost pill on the left, urgent toggle on the right. */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 text-body text-ink-soft focus-within:ring-1 focus-within:ring-ring">
          <span className="text-ink-mute">£</span>
          <input
            type="number"
            step="0.01"
            min="0"
            aria-label="Cost estimate (£)"
            value={item.cost_estimate_gbp ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ cost_estimate_gbp: v === "" ? null : Number(v) });
            }}
            placeholder="Cost"
            className="w-16 bg-transparent text-ink placeholder:text-ink-mute/70 focus-visible:outline-none"
          />
        </label>
        <Button
          type="button"
          variant={item.urgent ? "warm" : "warm-outline"}
          onClick={() => onChange({ urgent: !item.urgent })}
          icon={<FlagIcon filled={item.urgent} />}
        >
          {item.urgent ? "Urgent" : "Mark urgent"}
        </Button>
      </div>
    </li>
  );
}

export default function EventForm({
  variant,
  initial,
  extracted,
  fromExtraction,
  onSubmit,
  onDiscard,
}: EventFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [eventType, setEventType] = useState<EventType>(initial?.event_type ?? "other");
  const [startParts, setStartParts] = useState(() => isoToParts(initial?.start_time ?? null));
  const [endParts, setEndParts] = useState(() => isoToParts(initial?.end_time ?? null));
  const [isAllDay, setIsAllDay] = useState(initial?.is_all_day ?? false);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [actionItems, setActionItems] = useState<ActionItemInput[]>(
    initial?.action_items ?? [],
  );
  const [endError, setEndError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const start_time = partsToIso(startParts.date, startParts.time, isAllDay) as string;
    // An all-day event is single-day, so it carries no end timestamp.
    const end_time = isAllDay ? null : partsToIso(endParts.date, endParts.time, false);
    // The API and DB both require end_time strictly after start_time. The
    // min/minDate attributes can't catch everything (a blank end time anchors
    // to midnight; min is inclusive), so gate here before submitting.
    if (end_time && new Date(end_time) <= new Date(start_time)) {
      setEndError(
        endParts.time
          ? "The end must be after the start."
          : "Add an end time after the start, or clear the end date.",
      );
      return;
    }
    setEndError(null);
    onSubmit({
      title,
      event_type: eventType,
      start_time,
      end_time,
      is_all_day: isAllDay,
      location: location || null,
      description: description || null,
      action_items: actionItems,
      confidence: 1.0,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className=""
    >
      {fromExtraction && (
        <div className="mb-6 border-b border-hairline pb-4">
          <span className="inline-flex items-center gap-1.5 text-meta">
            Fields marked <ExtractedDot /> were read from your source
          </span>
        </div>
      )}

      {/* A disabled fieldset turns off every control inside, including the
          submit and discard buttons — one switch for the inert variants. */}
      <fieldset disabled={variant !== "active"} className="min-w-0">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <FieldLabel htmlFor="title" extracted={extracted.title}>
                Title
              </FieldLabel>
              <span className="text-meta">
                {title.length} / {EVENT_FIELD_LIMITS.title}
              </span>
            </div>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              // The API strips whitespace and rejects empty titles — block
              // whitespace-only values `required` alone would let through.
              pattern=".*\S.*"
              title="Title cannot be empty"
              maxLength={EVENT_FIELD_LIMITS.title}
              placeholder="Summer Bake Sale"
              className="flex h-11 w-full rounded-md border border-hairline bg-surface px-3.5 text-heading text-ink shadow-sm placeholder:text-ink-mute/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="event_type" extracted={extracted.event_type}>
              Type
            </FieldLabel>
            <select
              id="event_type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className={`${inputClass} capitalize`}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            {/* Starts: date is always editable; time greys out for all-day. */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="start_date" extracted={extracted.start_time}>
                Starts
              </FieldLabel>
              <div className="grid grid-cols-[240px_minmax(0,120px)] gap-2">
                <DatePicker
                  id="start_date"
                  // The API rejects start_time before year 2000 as suspicious.
                  minDate="2000-01-01"
                  value={startParts.date}
                  onChange={(date) => {
                    setStartParts((p) => ({ ...p, date }));
                    // An end before the new start can no longer be valid —
                    // clear it rather than submit a rejected range.
                    setEndParts((p) =>
                      p.date && date && p.date < date ? { date: "", time: "" } : p,
                    );
                    setEndError(null);
                  }}
                  required
                />
                <Input
                  id="start_time"
                  type="time"
                  aria-label="Start time"
                  value={startParts.time}
                  onChange={(e) => {
                    setStartParts((p) => ({ ...p, time: e.target.value }));
                    setEndError(null);
                  }}
                  disabled={isAllDay}
                  className="bg-surface"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-body text-ink">
              <Checkbox
                checked={isAllDay}
                onCheckedChange={(checked) => {
                  setIsAllDay(checked === true);
                  setEndError(null);
                }}
                className="bg-surface"
              />
              All day
            </label>

            {/* Ends: optional, and the whole row greys out for all-day. */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="end_date">Ends · optional</FieldLabel>
              <div className="grid grid-cols-[240px_minmax(0,120px)] gap-2">
                <DatePicker
                  id="end_date"
                  value={endParts.date}
                  onChange={(date) => {
                    setEndParts((p) => ({ ...p, date }));
                    setEndError(null);
                  }}
                  disabled={isAllDay}
                  minDate={startParts.date || undefined}
                  inputClassName={
                    !isAllDay && fromExtraction && !endParts.date ? "border-warm" : ""
                  }
                />
                <Input
                  id="end_time"
                  type="time"
                  aria-label="End time"
                  value={endParts.time}
                  onChange={(e) => {
                    setEndParts((p) => ({ ...p, time: e.target.value }));
                    setEndError(null);
                  }}
                  disabled={isAllDay}
                  // Same-day events must end after they start (the API rejects
                  // end_time <= start_time); the browser enforces min on submit.
                  min={
                    endParts.date && endParts.date === startParts.date
                      ? startParts.time || undefined
                      : undefined
                  }
                  className="bg-surface"
                />
              </div>
              {endError && (
                <p role="alert" className="flex items-center gap-1.5 text-meta text-destructive">
                  <span className="h-1 w-1 rounded-full bg-destructive" />
                  {endError}
                </p>
              )}
              {!isAllDay && fromExtraction && !endParts.date && !endParts.time && (
                <p className="flex items-center gap-1.5 text-meta text-warm">
                  <span className="h-1 w-1 rounded-full bg-warm" />
                  Not in the source — add it if you know it
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="location" extracted={extracted.location}>
              Location · optional
            </FieldLabel>
            <input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="School hall, Oakwood Primary"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <FieldLabel htmlFor="description" extracted={extracted.description}>
                Description · optional
              </FieldLabel>
              <span className="text-meta">
                {description.length} / {EVENT_FIELD_LIMITS.description}
              </span>
            </div>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={EVENT_FIELD_LIMITS.description}
              rows={3}
              className="flex w-full rounded-md border border-hairline bg-surface px-3 py-2 text-body text-ink shadow-sm placeholder:text-ink-mute/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="line-divider" />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel extracted={extracted.action_items}>
                Action items{actionItems.length ? ` · ${actionItems.length}` : ""}
              </FieldLabel>
              <button
                type="button"
                onClick={() =>
                  setActionItems((prev) => [
                    ...prev,
                    { description: "", cost_estimate_gbp: null, urgent: false },
                  ])
                }
                className="text-meta font-medium text-accent-dark underline-offset-4 hover:underline"
              >
                + Add item
              </button>
            </div>
            {actionItems.length === 0 ? (
              <p className="text-meta">No action items.</p>
            ) : (
              <ul className="space-y-3">
                {actionItems.map((item, idx) => (
                  <ActionItemCard
                    key={idx}
                    item={item}
                    onChange={(patch) =>
                      setActionItems((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
                      )
                    }
                    onRemove={() =>
                      setActionItems((prev) => prev.filter((_, i) => i !== idx))
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <button
          type="submit"
          className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-body font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {variant === "loading" ? "Creating…" : "Create event"}
        </button>
        <div className="mt-3.5 text-center">
          <button
            type="button"
            onClick={onDiscard}
            className="text-meta underline-offset-4 hover:text-ink hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {fromExtraction ? "Discard draft" : "Start over"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
