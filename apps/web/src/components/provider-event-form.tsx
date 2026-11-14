"use client";

import { useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { DatePicker } from "@repo/ui/components/date-picker";
import { Input } from "@repo/ui/components/input";
import {
  EVENT_FIELD_LIMITS,
  EVENT_TYPES,
  type EventType,
} from "@/lib/types/events";
import type { ProviderEventInput } from "@/lib/types/provider-events";
import { isoToParts, partsToIso } from "@/lib/utils/date";

type ProviderEventFormProps = {
  /** The event being edited, or null for a new one. Field state initializes
   *  from this once — remount with a fresh `key` to load a different event. */
  initial: ProviderEventInput | null;
  submitLabel: string;
  pending: boolean;
  onSubmit: (event: ProviderEventInput) => void;
  onCancel: () => void;
};

const inputClass =
  "flex h-9 w-full rounded-md border border-hairline bg-surface px-3 py-1 text-body text-ink shadow-sm placeholder:text-ink-mute/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-center gap-1.5 text-meta text-destructive"
    >
      <span className="h-1 w-1 rounded-full bg-destructive" />
      {children}
    </p>
  );
}

export default function ProviderEventForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: ProviderEventFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [eventType, setEventType] = useState<EventType>(
    initial?.event_type ?? "other",
  );
  const [startParts, setStartParts] = useState(() =>
    isoToParts(initial?.start_time ?? null),
  );
  const [endParts, setEndParts] = useState(() =>
    isoToParts(initial?.end_time ?? null),
  );
  const [isAllDay, setIsAllDay] = useState(initial?.is_all_day ?? false);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [capacity, setCapacity] = useState(
    initial?.capacity != null ? String(initial.capacity) : "",
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const start_time = partsToIso(startParts.date, startParts.time, isAllDay);
    // `required` on the DatePicker only guarantees non-empty text; text that
    // never parsed leaves the date empty, so this can still be null.
    if (!start_time) {
      setStartError("Pick a valid start date.");
      return;
    }
    setStartError(null);
    // An all-day event is single-day, so it carries no end timestamp.
    const end_time = isAllDay
      ? null
      : partsToIso(endParts.date, endParts.time, false);
    // The API and DB both require end_time strictly after start_time.
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
      title: title.trim(),
      event_type: eventType,
      start_time,
      end_time,
      is_all_day: isAllDay,
      location: location.trim() || null,
      description: description.trim() || null,
      // The input is type=number with min=1 step=1, so a non-empty value is a
      // positive integer by the time the form submits.
      capacity: capacity ? Number(capacity) : null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl">
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="title" className="text-eyebrow">
              Title
            </label>
            <span className="text-meta">
              {title.length} / {EVENT_FIELD_LIMITS.title}
            </span>
          </div>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            // The API strips whitespace and rejects empty titles.
            pattern=".*\S.*"
            title="Title cannot be empty"
            maxLength={EVENT_FIELD_LIMITS.title}
            placeholder="Under-9s football training"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="event_type" className="text-eyebrow">
            Type
          </label>
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

        <div className="space-y-1.5">
          <label htmlFor="start_date" className="text-eyebrow">
            Starts
          </label>
          <div className="grid grid-cols-[minmax(0,240px)_minmax(0,120px)] gap-2">
            <DatePicker
              id="start_date"
              // The API rejects start_time before year 2000 as suspicious.
              minDate="2000-01-01"
              value={startParts.date}
              onChange={(date) => {
                setStartParts((p) => ({ ...p, date }));
                // An end before the new start can no longer be valid.
                setEndParts((p) =>
                  p.date && date && p.date < date ? { date: "", time: "" } : p,
                );
                setStartError(null);
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
          {startError && <FieldError>{startError}</FieldError>}
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

        <div className="space-y-1.5">
          <label htmlFor="end_date" className="text-eyebrow">
            Ends · optional
          </label>
          <div className="grid grid-cols-[minmax(0,240px)_minmax(0,120px)] gap-2">
            <DatePicker
              id="end_date"
              value={endParts.date}
              onChange={(date) => {
                setEndParts((p) => ({ ...p, date }));
                setEndError(null);
              }}
              disabled={isAllDay}
              minDate={startParts.date || undefined}
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
              className="bg-surface"
            />
          </div>
          {endError && <FieldError>{endError}</FieldError>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="location" className="text-eyebrow">
            Location · optional
          </label>
          <input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Riverside pitch 2"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="description" className="text-eyebrow">
              Description · optional
            </label>
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

        <div className="space-y-1.5">
          <label htmlFor="capacity" className="text-eyebrow">
            Spots · optional
          </label>
          <Input
            id="capacity"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Unlimited"
            className="max-w-[160px] bg-surface"
          />
          <p className="text-meta">Leave empty if there is no limit.</p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="submit">{pending ? "Saving…" : submitLabel}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Back
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
