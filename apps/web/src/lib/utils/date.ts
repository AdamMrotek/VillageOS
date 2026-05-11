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

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(day: Date, today: Date = new Date()): string {
  if (isSameDay(day, today)) return "Today";
  if (isSameDay(day, addDays(today, 1))) return "Tomorrow";
  return day.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
