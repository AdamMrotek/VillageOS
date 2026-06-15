"use client";

import { useState } from "react";
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

function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [startTime, setStartTime] = useState(() => isoToLocalInput(initial?.start_time ?? null));
  const [endTime, setEndTime] = useState(() => isoToLocalInput(initial?.end_time ?? null));
  const [isAllDay, setIsAllDay] = useState(initial?.is_all_day ?? false);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [actionItems, setActionItems] = useState<ActionItemInput[]>(
    initial?.action_items ?? [],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      title,
      event_type: eventType,
      start_time: toIsoOrNull(startTime) as string,
      end_time: toIsoOrNull(endTime),
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="start_time" extracted={extracted.start_time}>
                Starts
              </FieldLabel>
              <input
                id="start_time"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="end_time">Ends · optional</FieldLabel>
              <input
                id="end_time"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`${inputClass} ${
                  fromExtraction && !endTime ? "border-warm" : ""
                }`}
              />
              {fromExtraction && !endTime && (
                <p className="flex items-center gap-1.5 text-meta text-warm">
                  <span className="h-1 w-1 rounded-full bg-warm" />
                  Not in the source — add it if you know it
                </p>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-body text-ink">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="accent-accent"
            />
            All day
          </label>

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
              <ul className="space-y-2">
                {actionItems.map((item, idx) => (
                  <li
                    key={idx}
                    className={`space-y-2 rounded-md border border-hairline bg-surface p-3 ${
                      item.urgent ? "line-warm-event" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        value={item.description}
                        onChange={(e) =>
                          setActionItems((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, description: e.target.value } : p,
                            ),
                          )
                        }
                        placeholder="Bring £2 in a labelled envelope"
                        className="flex-1 bg-surface text-body text-ink placeholder:text-ink-mute/60 focus-visible:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setActionItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-meta hover:text-destructive"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1 text-meta">
                        £
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.cost_estimate_gbp ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setActionItems((prev) =>
                              prev.map((p, i) =>
                                i === idx
                                  ? { ...p, cost_estimate_gbp: v === "" ? null : Number(v) }
                                  : p,
                              ),
                            );
                          }}
                          placeholder="cost"
                          className="h-7 w-24 rounded-sm border border-hairline bg-surface px-2 text-meta text-ink placeholder:text-ink-mute/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-meta text-warm">
                        <input
                          type="checkbox"
                          checked={item.urgent}
                          onChange={(e) =>
                            setActionItems((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, urgent: e.target.checked } : p,
                              ),
                            )
                          }
                          className="accent-warm"
                        />
                        urgent
                      </label>
                    </div>
                  </li>
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
