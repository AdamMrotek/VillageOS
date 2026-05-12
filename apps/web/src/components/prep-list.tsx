"use client";

import { useMemo } from "react";
import { cn } from "@repo/ui/lib/utils";
import type { ActionItem } from "@/lib/types/events";
import { addDays, isSameDay } from "@/lib/utils/date";
import { useCalendarStore } from "@/lib/stores/calendar-store";
import { useEvents } from "@/lib/queries/events";

type PrepEntry = {
  item: ActionItem;
  eventId: string;
  eventTitle: string;
  date: Date;
};

export default function PrepList() {
  const { data: events = [] } = useEvents();
  const setOpenEventId = useCalendarStore((s) => s.setOpenEventId);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const entries: PrepEntry[] = useMemo(() => {
    const out: PrepEntry[] = [];
    for (const event of events) {
      const eventDate = new Date(event.start_time);
      if (eventDate < today) continue;
      for (const item of event.action_items) {
        if (item.done) continue;
        out.push({
          item,
          eventId: event.id,
          eventTitle: event.title,
          date: eventDate,
        });
      }
    }
    out.sort((a, b) => {
      const d = a.date.getTime() - b.date.getTime();
      if (d !== 0) return d;
      if (a.item.urgent !== b.item.urgent) return a.item.urgent ? -1 : 1;
      return 0;
    });
    return out;
  }, [events, today]);

  return (
    <section className="rounded-2xl bg-accent-soft p-[22px]">
      <div className="mb-3.5">
        <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-accent-dark">
          01 · Overview
        </div>
        <h2 className="mt-1.5 font-display text-[22px] font-normal leading-tight tracking-tight text-ink">
          Current Week Prep
        </h2>
      </div>

      {entries.length === 0 ? (
        <div className="text-[12.5px] leading-relaxed text-accent-dark">
          Reminders surface here once events exist — gifts to buy, slips to
          sign, kits to wash.
        </div>
      ) : (
        <div>
          {groupByDay(entries).map((group, gi, all) => (
            <DayGroup
              key={group.date.toISOString()}
              date={group.date}
              today={today}
              items={group.items}
              isLast={gi === all.length - 1}
              onOpen={setOpenEventId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DayGroup({
  date,
  today,
  items,
  isLast,
  onOpen,
}: {
  date: Date;
  today: Date;
  items: PrepEntry[];
  isLast: boolean;
  onOpen: (eventId: string) => void;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[70px_1fr] items-start gap-2.5 py-2.5",
        !isLast && "border-b border-accent-dark/15",
      )}
    >
      <div className="pt-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-accent-dark">
        {dayBadge(date, today)}
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map((entry) => (
          <PrepItem
            key={entry.item.id}
            entry={entry}
            onOpen={() => onOpen(entry.eventId)}
          />
        ))}
      </div>
    </div>
  );
}

function PrepItem({
  entry,
  onOpen,
}: {
  entry: PrepEntry;
  onOpen: () => void;
}) {
  const { item, eventTitle } = entry;
  const meta =
    item.cost_estimate_gbp != null
      ? `${eventTitle} · £${item.cost_estimate_gbp.toFixed(0)}`
      : eventTitle;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-[4px] text-left transition-colors hover:bg-accent-dark/5 focus:outline-none focus-visible:bg-accent-dark/5"
    >
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <span>{item.description}</span>
        {item.urgent && (
          <span className="rounded-[3px] bg-warm px-1.5 py-[2px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-surface">
            URGENT
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-accent-dark">{meta}</div>
    </button>
  );
}

function groupByDay(entries: PrepEntry[]) {
  const map = new Map<string, { date: Date; items: PrepEntry[] }>();
  for (const e of entries) {
    const d = new Date(e.date);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { date: d, items: [] };
      map.set(key, bucket);
    }
    bucket.items.push(e);
  }
  return Array.from(map.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

function dayBadge(date: Date, today: Date): string {
  if (isSameDay(date, today)) return "TODAY";
  if (isSameDay(date, addDays(today, 1))) return "TOMORROW";
  return date
    .toLocaleDateString("en-GB", { weekday: "short" })
    .toUpperCase();
}
