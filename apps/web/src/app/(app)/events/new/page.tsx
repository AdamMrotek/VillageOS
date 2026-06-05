"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCreateEvent, useExtractEvent } from "@/lib/queries/events";
import {
  EVENT_FIELD_LIMITS,
  EVENT_TYPES,
  type ActionItemInput,
  type EventType,
} from "@/lib/types/events";
import PageLayout from "@/components/page-layout";

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

export default function NewEventPage() {
  const router = useRouter();

  const extractMutation = useExtractEvent();
  const createMutation = useCreateEvent();

  const [rawText, setRawText] = useState("");

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("other");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [actionItems, setActionItems] = useState<ActionItemInput[]>([]);

  function handleExtract() {
    if (rawText.trim().length < 10) {
      toast.error("Paste at least 10 characters of text");
      return;
    }
    // Errors (incl. a 429 quota hit → sign-up CTA) are handled in
    // useExtractEvent's onError, so we only wire success here.
    extractMutation.mutate(rawText, {
      onSuccess: (res) => {
        const e = res.event;
        setTitle(e.title);
        setEventType(e.event_type);
        setStartTime(isoToLocalInput(e.start_time));
        setEndTime(isoToLocalInput(e.end_time));
        setIsAllDay(e.is_all_day);
        setLocation(e.location ?? "");
        setDescription(e.description ?? "");
        setActionItems(e.action_items);
      },
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate(
      {
        title,
        event_type: eventType,
        start_time: toIsoOrNull(startTime) as string,
        end_time: toIsoOrNull(endTime),
        is_all_day: isAllDay,
        location: location || null,
        description: description || null,
        action_items: actionItems,
        confidence: 1.0,
      },
      {
        onSuccess: () => {
          router.push("/events");
          router.refresh();
        },
      },
    );
  }

  const inputClass =
    "flex h-9 w-full rounded-md border border-hairline bg-surface px-3 py-1 text-body text-ink shadow-sm placeholder:text-ink-mute/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <PageLayout title="New event" backHref="/events" backLabel="Back to events">
      <div className="grid gap-10 md:grid-cols-2">
        <section className="space-y-4">
          <div className="space-y-2">
            <p className="text-eyebrow-accent">AI extraction</p>
            <h2 className="text-heading text-ink">Paste text</h2>
            <p className="text-meta">
              WhatsApp thread, school newsletter, email — anything with an event.
            </p>
          </div>

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={14}
            maxLength={8000}
            placeholder="Reminder from school: Bake Sale this Friday 24th May at 3pm in the school hall. Please bring £2 in a labelled envelope."
            className="w-full rounded-md border border-hairline bg-surface px-3 py-2 text-body text-ink shadow-sm placeholder:text-ink-mute/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <div className="flex items-center justify-between">
            <span className="text-meta">{rawText.length} / 8000</span>
            <button
              type="button"
              onClick={handleExtract}
              disabled={extractMutation.isPending || rawText.trim().length < 10}
              className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 py-2 text-body font-medium text-accent-foreground shadow hover:bg-accent-dark disabled:pointer-events-none disabled:opacity-50"
            >
              {extractMutation.isPending ? "Extracting…" : "Extract event →"}
            </button>
          </div>

        </section>

        <form onSubmit={handleSubmit} className="space-y-5">
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
              maxLength={EVENT_FIELD_LIMITS.title}
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
              className={inputClass}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="start_time" className="text-eyebrow">
                Starts
              </label>
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
              <label htmlFor="end_time" className="text-eyebrow">
                Ends (optional)
              </label>
              <input
                id="end_time"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
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
            <label htmlFor="location" className="text-eyebrow">
              Location (optional)
            </label>
            <input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="description" className="text-eyebrow">
                Description (optional)
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

          <div className="line-divider" />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-eyebrow">Action items</label>
              <button
                type="button"
                onClick={() =>
                  setActionItems((prev) => [
                    ...prev,
                    { description: "", cost_estimate_gbp: null, urgent: false },
                  ])
                }
                className="text-meta underline-offset-4 hover:text-ink hover:underline"
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

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create event"}
          </button>
        </form>
      </div>
    </PageLayout>
  );
}
