"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import {
  EVENT_TYPES,
  type ActionItemInput,
  type EventType,
  type ExtractResponse,
} from "@/lib/types/events";

function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewEventPage() {
  const router = useRouter();

  const [rawText, setRawText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model: string; tokens: number; confidence: number } | null>(null);

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("other");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [actionItems, setActionItems] = useState<ActionItemInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleExtract() {
    if (rawText.trim().length < 10) {
      setExtractError("Paste at least 10 characters of text");
      return;
    }
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await apiClient<ExtractResponse>("/api/extract", {
        method: "POST",
        body: JSON.stringify({ raw_text: rawText }),
      });
      const e = res.event;
      setTitle(e.title);
      setEventType(e.event_type);
      setStartTime(isoToLocalInput(e.start_time));
      setEndTime(isoToLocalInput(e.end_time));
      setIsAllDay(e.is_all_day);
      setLocation(e.location ?? "");
      setDescription(e.description ?? "");
      setActionItems(e.action_items);
      setMeta({ model: res.model_used, tokens: res.tokens_used, confidence: e.confidence });
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient("/api/events", {
        method: "POST",
        body: JSON.stringify({
          title,
          event_type: eventType,
          start_time: toIsoOrNull(startTime),
          end_time: toIsoOrNull(endTime),
          is_all_day: isAllDay,
          location: location || null,
          description: description || null,
          action_items: actionItems,
          confidence: meta?.confidence ?? 1.0,
        }),
      });
      router.push("/events");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New event</h1>
        <p className="text-sm text-muted-foreground">
          <Link href="/events" className="underline underline-offset-4">
            Back to events
          </Link>
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">Paste text</h2>
            <p className="text-xs text-muted-foreground">
              WhatsApp thread, school newsletter, email — anything with an event.
            </p>
          </div>

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={14}
            maxLength={8000}
            placeholder="Reminder from school: Bake Sale this Friday 24th May at 3pm in the school hall. Please bring £2 in a labelled envelope."
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{rawText.length} / 8000</span>
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting || rawText.trim().length < 10}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {extracting ? "Extracting…" : "Extract event →"}
            </button>
          </div>

          {extractError && <p className="text-sm text-destructive">{extractError}</p>}

          {meta && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              Model: <span className="font-mono">{meta.model}</span> · Tokens: {meta.tokens} ·
              Confidence: {(meta.confidence * 100).toFixed(0)}%
            </div>
          )}
        </section>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="title" className="text-sm font-medium">
              Title
            </label>
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={60}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="event_type" className="text-sm font-medium">
              Type
            </label>
            <select
              id="event_type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="start_time" className="text-sm font-medium">
                Starts
              </label>
              <input
                id="start_time"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="end_time" className="text-sm font-medium">
                Ends (optional)
              </label>
              <input
                id="end_time"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
            />
            All day
          </label>

          <div className="space-y-1">
            <label htmlFor="location" className="text-sm font-medium">
              Location (optional)
            </label>
            <input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="description" className="text-sm font-medium">
              Description (optional)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={120}
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Action items</label>
              <button
                type="button"
                onClick={() =>
                  setActionItems((prev) => [
                    ...prev,
                    { description: "", cost_estimate_gbp: null, urgent: false },
                  ])
                }
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                + Add item
              </button>
            </div>
            {actionItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No action items.</p>
            ) : (
              <ul className="space-y-2">
                {actionItems.map((item, idx) => (
                  <li
                    key={idx}
                    className="space-y-2 rounded-md border p-2 text-sm"
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
                        className="flex-1 bg-transparent text-sm focus-visible:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setActionItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
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
                          className="h-7 w-24 rounded border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-amber-600">
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
                        />
                        urgent
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create event"}
          </button>
        </form>
      </div>
    </main>
  );
}
