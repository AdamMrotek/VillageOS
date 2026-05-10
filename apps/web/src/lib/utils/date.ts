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
