import { CALENDAR_LOCALE } from "@/lib/config/calendar";
import type { EventSnapshot } from "@/lib/types/events";
import { formatTime } from "@/lib/utils/date";

type When = Pick<EventSnapshot, "start_time" | "end_time" | "is_all_day">;

/** "Fri, 20 Nov 2026 · 16:00 – 17:00", or "Fri, 20 Nov 2026 · All day". */
export function formatEventWhen(event: When): string {
  const start = new Date(event.start_time);
  const day = start.toLocaleDateString(CALENDAR_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (event.is_all_day) return `${day} · All day`;
  const time = event.end_time
    ? `${formatTime(start)} – ${formatTime(event.end_time)}`
    : formatTime(start);
  return `${day} · ${time}`;
}

/** What a provider changed about a reserved event since the parent last saw
 *  it, one sentence per change. Compares only what a parent plans around —
 *  time, place and cancellation — and is empty when none of those differ. */
export function describeChanges(
  previous: EventSnapshot,
  current: EventSnapshot,
): string[] {
  if (current.status === "cancelled") {
    return previous.status === "cancelled"
      ? []
      : ["The organiser cancelled this event."];
  }
  const changes: string[] = [];
  const before = formatEventWhen(previous);
  if (before !== formatEventWhen(current)) {
    changes.push(`Time changed — it was ${before}.`);
  }
  if (previous.location !== current.location) {
    changes.push(
      previous.location
        ? `Location changed — it was ${previous.location}.`
        : "A location was added.",
    );
  }
  return changes;
}
