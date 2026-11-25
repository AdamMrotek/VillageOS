import { CALENDAR_LOCALE } from "@/lib/config/calendar";

type DateRangeInput = {
  start: string | Date;
  end?: string | Date | null;
  allDay?: boolean;
};

export function formatRange({ start, end, allDay = false }: DateRangeInput): string {
  const startDate = start instanceof Date ? start : new Date(start);
  const startStr = allDay
    ? startDate.toLocaleDateString()
    : startDate.toLocaleString();
  if (!end) return startStr;
  const endDate = end instanceof Date ? end : new Date(end);
  const endStr = allDay ? endDate.toLocaleDateString() : endDate.toLocaleString();
  return `${startStr} → ${endStr}`;
}

export function addDays(date: Date, n: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + n);
  return result;
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleTimeString(CALENDAR_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDayLabel(day: Date, today: Date = new Date()): string {
  if (isSameDay(day, today)) return "Today";
  if (isSameDay(day, addDays(today, 1))) return "Tomorrow";
  return day.toLocaleDateString(CALENDAR_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Split an ISO timestamp into the `date` (YYYY-MM-DD) and `time` (HH:mm) parts
// the native <input type="date"> / <input type="time"> controls expect, in the
// viewer's local zone. Empty parts for a null/invalid input.
export function isoToParts(iso: string | null): { date: string; time: string } {
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
export function partsToIso(date: string, time: string, allDay: boolean): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${allDay || !time ? "00:00" : time}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
