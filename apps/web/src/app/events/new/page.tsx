"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { EVENT_TYPES, type EventType } from "@/lib/types/events";

function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export default function NewEventPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("other");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
          action_items: [],
          confidence: 1.0,
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
    <main className="mx-auto w-full max-w-lg space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New event</h1>
        <p className="text-sm text-muted-foreground">
          <Link href="/events" className="underline underline-offset-4">
            Back to events
          </Link>
        </p>
      </div>

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

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create event"}
        </button>
      </form>
    </main>
  );
}
