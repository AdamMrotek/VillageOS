"use client";

import { useMemo, useState } from "react";
import { cn } from "@repo/ui/lib/utils";
import type { EventType } from "@/lib/types/events";
import { eventTypeStyle } from "@/lib/event-styles";
import { addDays, isSameDay } from "@/lib/utils/date";
import { useCalendarStore } from "@/lib/stores/calendar-store";
import { useEvents } from "@/lib/queries/events";

const MAX_DOTS_PER_DAY = 3;

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export default function MonthCalendar() {
  const { data: events = [] } = useEvents();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [anchor, setAnchor] = useState<Date>(() => {
    const d = new Date(today);
    d.setDate(1);
    return d;
  });

  const grid = useMemo(() => buildMonthGrid(anchor), [anchor]);

  const weekAnchor = useCalendarStore((s) => s.weekAnchor);
  const setWeekAnchor = useCalendarStore((s) => s.setWeekAnchor);
  const activeWeekEnd = useMemo(() => addDays(weekAnchor, 7), [weekAnchor]);

  const eventTypesByDay = useMemo(() => {
    const map = new Map<string, EventType[]>();
    const sorted = [...events].sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
    for (const e of sorted) {
      const d = new Date(e.start_time);
      d.setHours(0, 0, 0, 0);
      const key = d.toDateString();
      const list = map.get(key);
      if (list) {
        if (!list.includes(e.event_type)) list.push(e.event_type);
      } else {
        map.set(key, [e.event_type]);
      }
    }
    return map;
  }, [events]);

  const monthLabel = anchor.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  function shiftMonth(delta: number) {
    setAnchor((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + delta);
      d.setDate(1);
      return d;
    });
  }

  return (
    <section className="flex w-full max-w-[300px] flex-col rounded-2xl border border-hairline bg-surface p-[14px]">
      <div className="mb-3.5 flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-accent-dark">
            Month
          </div>
          <h2 className="mt-1.5 font-display text-[20px] font-normal leading-tight tracking-tight text-ink">
            {monthLabel}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <NavButton onClick={() => shiftMonth(-1)} label="Previous month">
            <Chevron direction="left" />
          </NavButton>
          <NavButton onClick={() => shiftMonth(1)} label="Next month">
            <Chevron direction="right" />
          </NavButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={`${w}-${i}`}
            className="pb-1 text-center font-mono text-[9px] font-semibold uppercase tracking-wider text-accent-dark"
          >
            {w}
          </div>
        ))}
        {grid.map((day) => {
          const inMonth = day.getMonth() === anchor.getMonth();
          const isToday = isSameDay(day, today);
          const dayTypes = eventTypesByDay.get(day.toDateString()) ?? [];
          const dotTypes = dayTypes.slice(0, MAX_DOTS_PER_DAY);
          const inActiveWeek = day >= weekAnchor && day < activeWeekEnd;
          const dow = day.getDay();
          const isWeekStart = inActiveWeek && dow === 1;
          const isWeekEnd = inActiveWeek && dow === 0;
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setWeekAnchor(day)}
              aria-label={`Jump to week of ${day.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`}
              aria-pressed={inActiveWeek}
              className="relative flex aspect-square items-center justify-center text-[11px] tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-dark/40"
            >
              {inActiveWeek && !isToday && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-[2px] left-0 right-0 border-y border-hairline bg-surface-alt",
                    isWeekStart &&
                      "left-[2px] rounded-l-md border-l",
                    isWeekEnd &&
                      "right-[2px] rounded-r-md border-r",
                  )}
                />
              )}
              {isToday && (
                <span
                  aria-hidden="true"
                  className="absolute inset-[2px] rounded-md bg-ink"
                />
              )}
              <span
                className={cn(
                  "relative",
                  !inMonth && "text-ink-mute/40",
                  inMonth && !isToday && "text-ink",
                  isToday && "font-medium text-surface",
                )}
              >
                {day.getDate()}
              </span>
              {dotTypes.length > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute bottom-[3px] flex items-center gap-[2px]",
                    !inMonth && "opacity-40",
                  )}
                >
                  {dotTypes.map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className={cn(
                        "size-1 rounded-full",
                        isToday ? "bg-accent-soft" : eventTypeStyle(t).dot,
                      )}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function buildMonthGrid(anchor: Date): Date[] {
  const firstOfMonth = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    1,
  );
  const dayOfWeek = firstOfMonth.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() + offset);

  const out: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    d.setHours(0, 0, 0, 0);
    out.push(d);
  }
  return out;
}

function NavButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-accent-dark/20 text-accent-dark transition hover:bg-accent-dark/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-dark/40"
    >
      {children}
    </button>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "left" ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 18 15 12 9 6" />
      )}
    </svg>
  );
}
