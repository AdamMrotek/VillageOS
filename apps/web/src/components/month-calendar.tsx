"use client";

import { useMemo, useState } from "react";
import { cn } from "@repo/ui/lib/utils";
import type { EventType } from "@/lib/types/events";
import { eventTypeStyle } from "@/lib/event-styles";
import { addDays, isSameDay } from "@/lib/utils/date";
import {
  useCalendarStore,
  useToday,
  useWeekAnchor,
} from "@/lib/stores/calendar-store";
import { useEvents } from "@/lib/queries/events";
import {
  CALENDAR_LOCALE,
  DAY_MONTH_FORMAT,
  DAYS_PER_WEEK,
  MAX_DOTS_PER_DAY,
  MONTH_GRID_DAYS,
  MONTH_LABEL_FORMAT,
  WEEKDAY_LABELS_LETTER,
} from "@/lib/config/calendar";

export default function MonthCalendar() {
  const { data: events = [] } = useEvents();
  // `today` comes from the store, which resolves it on the client after mount.
  // It is `null` during SSR/first paint, so the date-dependent highlights below
  // are guarded on a non-null value to avoid an off-by-one hydration mismatch.
  const today = useToday();

  // Track the displayed month as an offset from the current month and derive the
  // anchor from `today`, rather than seeding it eagerly with `new Date()`. An
  // eager seed would run during SSR (in UTC) and bake a server-timezone month
  // into the HTML, causing an off-by-one hydration mismatch at month boundaries
  // — the same reason `today`/`weekAnchor` are null-until-mount in the store.
  const [monthOffset, setMonthOffset] = useState(0);
  const anchor = useMemo(() => {
    if (!today) return null;
    const monthStart = new Date(today);
    monthStart.setDate(1);
    monthStart.setMonth(monthStart.getMonth() + monthOffset);
    return monthStart;
  }, [today, monthOffset]);

  const grid = useMemo(() => (anchor ? buildMonthGrid(anchor) : []), [anchor]);

  const weekAnchor = useWeekAnchor();
  const setWeekAnchor = useCalendarStore((s) => s.setWeekAnchor);
  const activeWeekEnd = useMemo(
    () => (weekAnchor ? addDays(weekAnchor, DAYS_PER_WEEK) : null),
    [weekAnchor],
  );

  const eventTypesByDay = useMemo(() => {
    const typesByDay = new Map<string, EventType[]>();
    const sortedEvents = [...events].sort(
      (eventA, eventB) =>
        new Date(eventA.start_time).getTime() -
        new Date(eventB.start_time).getTime(),
    );
    for (const event of sortedEvents) {
      const eventDate = new Date(event.start_time);
      eventDate.setHours(0, 0, 0, 0);
      const dayKey = eventDate.toDateString();
      const dayTypes = typesByDay.get(dayKey);
      if (dayTypes) {
        if (!dayTypes.includes(event.event_type)) {
          dayTypes.push(event.event_type);
        }
      } else {
        typesByDay.set(dayKey, [event.event_type]);
      }
    }
    return typesByDay;
  }, [events]);

  function shiftMonth(delta: number) {
    setMonthOffset((prev) => prev + delta);
  }

  if (!anchor) return <MonthCalendarSkeleton />;

  const monthLabel = anchor.toLocaleDateString(
    CALENDAR_LOCALE,
    MONTH_LABEL_FORMAT,
  );

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
        {WEEKDAY_LABELS_LETTER.map((weekdayLabel, weekdayIndex) => (
          <div
            key={`${weekdayLabel}-${weekdayIndex}`}
            className="pb-1 text-center font-mono text-[9px] font-semibold uppercase tracking-wider text-accent-dark"
          >
            {weekdayLabel}
          </div>
        ))}
        {grid.map((day) => {
          const inMonth = day.getMonth() === anchor.getMonth();
          const isToday = today != null && isSameDay(day, today);
          const dayTypes = eventTypesByDay.get(day.toDateString()) ?? [];
          const dotTypes = dayTypes.slice(0, MAX_DOTS_PER_DAY);
          const inActiveWeek =
            weekAnchor != null &&
            activeWeekEnd != null &&
            day >= weekAnchor &&
            day < activeWeekEnd;
          const dayOfWeek = day.getDay();
          const isWeekStart = inActiveWeek && dayOfWeek === 1;
          const isWeekEnd = inActiveWeek && dayOfWeek === 0;
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setWeekAnchor(day)}
              aria-label={`Jump to week of ${day.toLocaleDateString(CALENDAR_LOCALE, DAY_MONTH_FORMAT)}`}
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
                  {dotTypes.map((eventType, dotIndex) => (
                    <span
                      key={`${eventType}-${dotIndex}`}
                      className={cn(
                        "size-1 rounded-full",
                        isToday
                          ? "bg-accent-soft"
                          : eventTypeStyle(eventType).dot,
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

function MonthCalendarSkeleton() {
  return (
    <section className="flex w-full max-w-[300px] flex-col rounded-2xl border border-hairline bg-surface p-[14px]">
      <div className="mb-3.5">
        <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-accent-dark">
          Month
        </div>
      </div>
      <div className="min-h-[260px]" aria-hidden="true" />
    </section>
  );
}

function buildMonthGrid(anchor: Date): Date[] {
  const firstOfMonth = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    1,
  );
  const firstDayOfWeek = firstOfMonth.getDay();
  const offsetToMonday = firstDayOfWeek === 0 ? -6 : 1 - firstDayOfWeek;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() + offsetToMonday);

  const days: Date[] = [];
  for (let dayIndex = 0; dayIndex < MONTH_GRID_DAYS; dayIndex++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + dayIndex);
    day.setHours(0, 0, 0, 0);
    days.push(day);
  }
  return days;
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
