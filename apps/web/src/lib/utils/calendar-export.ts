import type { StoredEvent } from "@/lib/types/events";

// Used when an event has no end_time — calendars need a duration.
export const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

const ATTRIBUTION = "Added from VillageOS";

type ExportableEvent = Pick<
  StoredEvent,
  | "id"
  | "title"
  | "start_time"
  | "end_time"
  | "is_all_day"
  | "location"
  | "description"
  | "action_items"
>;

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** UTC basic format: YYYYMMDDTHHmmssZ */
function formatUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Local calendar date, basic format: YYYYMMDD (matches how the UI shows the day). */
function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function nextLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

function resolveRange(event: ExportableEvent): { start: Date; end: Date } {
  const start = new Date(event.start_time);
  if (event.is_all_day) {
    // Exclusive end: always the day after the start day (multi-day all-day
    // events are not modelled).
    return { start, end: nextLocalDay(start) };
  }
  const end = event.end_time
    ? new Date(event.end_time)
    : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
  return { start, end };
}

function formatDates(event: ExportableEvent): string {
  const { start, end } = resolveRange(event);
  return event.is_all_day
    ? `${formatLocalDate(start)}/${formatLocalDate(end)}`
    : `${formatUtc(start)}/${formatUtc(end)}`;
}

function buildDetails(event: ExportableEvent): string {
  const parts: string[] = [];
  if (event.description) parts.push(event.description);
  if (event.action_items.length > 0) {
    parts.push(
      "To do:\n" +
        event.action_items
          .map((i) => `${i.done ? "[x]" : "[ ]"} ${i.description}`)
          .join("\n"),
    );
  }
  parts.push(ATTRIBUTION);
  return parts.join("\n\n");
}

export function buildGoogleCalendarUrl(event: ExportableEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: formatDates(event),
    details: buildDetails(event),
  });
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---------- ICS (RFC 5545) ----------

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line to <= 75 octets per line, continuation lines start with a space. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // First line may hold 75 octets; continuation lines 74 (leading space counts).
  let limit = 75;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit) {
      out.push(current);
      current = ch;
      currentBytes = chBytes;
      limit = 74;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

/** `now` is injected so callers (click handlers) own the clock read. */
export function buildIcs(event: ExportableEvent, now: Date): string {
  const { start, end } = resolveRange(event);
  const dtLines = event.is_all_day
    ? [
        `DTSTART;VALUE=DATE:${formatLocalDate(start)}`,
        `DTEND;VALUE=DATE:${formatLocalDate(end)}`,
      ]
    : [`DTSTART:${formatUtc(start)}`, `DTEND:${formatUtc(end)}`];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VillageOS//Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@villageos`,
    `DTSTAMP:${formatUtc(now)}`,
    ...dtLines,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(buildDetails(event))}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export function icsFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${slug || "event"}.ics`;
}

/** Browser-only. Call from an event handler. */
export function downloadIcs(event: ExportableEvent): void {
  const blob = new Blob([buildIcs(event, new Date())], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = icsFilename(event.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function openGoogleCalendar(event: ExportableEvent): void {
  window.open(buildGoogleCalendarUrl(event), "_blank", "noopener,noreferrer");
}
