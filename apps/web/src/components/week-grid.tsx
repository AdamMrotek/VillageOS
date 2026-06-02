"use client";

import { useMemo } from "react";
import { cn } from "@repo/ui/lib/utils";
import type { StoredEvent } from "@/lib/types/events";
import { eventTypeStyle } from "@/lib/event-styles";
import { addDays, formatTime, isSameDay } from "@/lib/utils/date";
import {
  useCalendarStore,
  useToday,
  useWeekAnchor,
} from "@/lib/stores/calendar-store";
import { useEvents } from "@/lib/queries/events";
import { LoadingOverlay } from "@/components/loading-overlay";
import {
  CALENDAR_LOCALE,
  DAY_MONTH_FORMAT,
  WEEKDAY_SHORT_FORMAT,
} from "@/lib/config/calendar";

// Stable empty reference for days with no events, so lookups don't allocate a
// fresh array each render.
const EMPTY_EVENTS: StoredEvent[] = [];

export default function WeekGrid() {
  const today = useToday();
  const anchor = useWeekAnchor();
  const shiftWeek = useCalendarStore((s) => s.shiftWeek);
  const goToToday = useCalendarStore((s) => s.goToToday);
  const setOpenEventId = useCalendarStore((s) => s.setOpenEventId);
  const { data: events = [], isPending, isFetching } = useEvents();

  // Index events by day once (sorted within each day) so the columns below are
  // O(1) lookups instead of re-filtering the full event list for all 9 days on
  // every render.
  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, StoredEvent[]>();
    for (const e of events) {
      const key = new Date(e.start_time).toDateString();
      const list = byDay.get(key);
      if (list) list.push(e);
      else byDay.set(key, [e]);
    }
    for (const list of byDay.values()) {
      list.sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
    }
    return byDay;
  }, [events]);

  const loading = isPending || isFetching;

  // `anchor` is null until the client mounts (see useWeekAnchor). The whole grid
  // is built off it, so render a minimal shell — with the loading overlay on top
  // — rather than a UTC-derived week into the SSR HTML (a hydration mismatch).
  if (!anchor) {
    return (
      <div className="relative flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface">
        <div className="flex items-start justify-between gap-4 border-b-2 border-ink px-7 pb-4 pt-6">
          <div>
            <div className="text-eyebrow-accent">02 · Calendar</div>
            <h2 className="mt-2 whitespace-nowrap text-title text-ink">Week</h2>
          </div>
        </div>
        <div className="min-h-[420px]" aria-hidden="true" />
        <LoadingOverlay loading={loading} label="Loading week…" />
      </div>
    );
  }

  // 9 days total: index 0 = peek-before, 1..7 = main week, 8 = peek-after
  const days = Array.from({ length: 9 }, (_, i) => addDays(anchor, i - 1));
  const dayEvents = days.map(
    (day) => eventsByDay.get(day.toDateString()) ?? EMPTY_EVENTS,
  );

  const totalVisible = dayEvents.reduce((sum, list) => sum + list.length, 0);
  const containsToday =
    today != null && days.slice(1, 8).some((d) => isSameDay(d, today));

  const weekLabel = `Week of ${days[1].toLocaleDateString(CALENDAR_LOCALE, DAY_MONTH_FORMAT)}`;

  const goPrev = () => shiftWeek(-1);
  const goNext = () => shiftWeek(1);
  const goToday = () => goToToday();

  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface">
      <GridHeader
        weekLabel={weekLabel}
        containsToday={containsToday}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
      />

      {totalVisible === 0 ? (
        <EmptyBody />
      ) : (
        <>
          <div
            className="hidden md:grid"
            style={{ gridTemplateColumns: "0.45fr repeat(7, 1fr) 0.45fr" }}
          >
            {days.map((day, i) => {
              const isPeek = i === 0 || i === 8;
              return (
                <DayColumn
                  key={day.toISOString()}
                  day={day}
                  isToday={today != null && isSameDay(day, today)}
                  isPeek={isPeek}
                  events={dayEvents[i]}
                  onOpen={setOpenEventId}
                  onJump={isPeek ? (i === 0 ? goPrev : goNext) : undefined}
                  isLast={i === days.length - 1}
                />
              );
            })}
          </div>
          <div className="flex flex-col md:hidden">
            {days.map((day, i) => {
              const isPeek = i === 0 || i === 8;
              return (
                <DayRow
                  key={day.toISOString()}
                  day={day}
                  isToday={today != null && isSameDay(day, today)}
                  isPeek={isPeek}
                  events={dayEvents[i]}
                  onOpen={setOpenEventId}
                  onJump={isPeek ? (i === 0 ? goPrev : goNext) : undefined}
                  isLast={i === days.length - 1}
                />
              );
            })}
          </div>
        </>
      )}
      <LoadingOverlay loading={loading} label="Loading week…" />
    </div>
  );
}

function GridHeader({
  weekLabel,
  containsToday,
  onPrev,
  onNext,
  onToday,
}: {
  weekLabel: string;
  containsToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b-2 border-ink px-7 pb-4 pt-6">
      <div>
        <div className="text-eyebrow-accent">02 · Calendar</div>
        <h2 className="mt-2 whitespace-nowrap text-title text-ink">
          {weekLabel}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <NavButton onClick={onPrev} label="Previous week">
            <Chevron direction="left" />
          </NavButton>
          {!containsToday && (
            <button
              type="button"
              onClick={onToday}
              className="rounded-sm border border-hairline px-2.5 py-1 font-mono text-[11px] text-ink-mute transition hover:bg-surface-alt hover:text-ink"
            >
              Today
            </button>
          )}
          <NavButton onClick={onNext} label="Next week">
            <Chevron direction="right" />
          </NavButton>
        </div>
      </div>
    </div>
  );
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
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-hairline text-ink-mute transition hover:bg-surface-alt hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
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

function DayColumn({
  day,
  isToday,
  isPeek,
  events,
  onOpen,
  onJump,
  isLast,
}: {
  day: Date;
  isToday: boolean;
  isPeek: boolean;
  events: StoredEvent[];
  onOpen: (id: string) => void;
  onJump?: () => void;
  isLast: boolean;
}) {
  const weekday = day.toLocaleDateString(CALENDAR_LOCALE, WEEKDAY_SHORT_FORMAT);
  const dateNum = day.getDate().toString().padStart(2, "0");

  return (
    <div
      className={cn(
        "flex min-h-[420px] flex-col",
        !isLast && "border-r border-hairline",
        isPeek && "bg-surface-alt/40",
      )}
    >
      <button
        type="button"
        onClick={onJump}
        disabled={!onJump}
        className={cn(
          "block h-[68px] w-full border-b border-hairline px-3.5 py-3 text-left transition",
          isToday && "bg-ink",
          isPeek && "cursor-pointer hover:bg-surface-alt/80",
          !isPeek && "cursor-default",
        )}
      >
        <div
          className={cn(
            "text-eyebrow",
            isToday && "text-accent-soft",
            isPeek && !isToday && "opacity-70",
          )}
        >
          {weekday}
        </div>
        <div
          className={cn(
            "mt-1 font-display text-[22px] leading-tight tabular-nums tracking-tight",
            isToday ? "text-surface" : "text-ink",
            isPeek && !isToday && "text-ink-mute",
          )}
        >
          {dateNum}
        </div>
      </button>
      <div
        className={cn(
          "flex flex-1 flex-col gap-1.5 p-2.5",
          isPeek && "opacity-60",
        )}
      >
        {events.map((event) => (
          <EventChip
            key={event.id}
            event={event}
            compact={isPeek}
            onClick={() => onOpen(event.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DayRow({
  day,
  isToday,
  isPeek,
  events,
  onOpen,
  onJump,
  isLast,
}: {
  day: Date;
  isToday: boolean;
  isPeek: boolean;
  events: StoredEvent[];
  onOpen: (id: string) => void;
  onJump?: () => void;
  isLast: boolean;
}) {
  const weekday = day.toLocaleDateString(CALENDAR_LOCALE, WEEKDAY_SHORT_FORMAT);
  const dateNum = day.getDate().toString().padStart(2, "0");

  return (
    <div
      className={cn(
        "flex items-stretch",
        !isLast && "border-b border-hairline",
        isPeek && "bg-surface-alt/40",
      )}
    >
      <button
        type="button"
        onClick={onJump}
        disabled={!onJump}
        className={cn(
          "flex w-[88px] shrink-0 flex-col items-start justify-center gap-1 border-r border-hairline px-3.5 py-3 text-left transition",
          isToday && "bg-ink",
          isPeek && "cursor-pointer hover:bg-surface-alt/80",
          !isPeek && "cursor-default",
        )}
      >
        <div
          className={cn(
            "text-eyebrow",
            isToday && "text-accent-soft",
            isPeek && !isToday && "opacity-70",
          )}
        >
          {weekday}
        </div>
        <div
          className={cn(
            "font-display text-[22px] leading-none tabular-nums tracking-tight",
            isToday ? "text-surface" : "text-ink",
            isPeek && !isToday && "text-ink-mute",
          )}
        >
          {dateNum}
        </div>
      </button>
      {events.length === 0 ? (
        <div className="flex flex-1 items-center px-4 font-mono text-[10px] text-ink-mute">
          —
        </div>
      ) : (
        <div
          className={cn(
            "flex min-w-0 flex-1 gap-2 overflow-x-auto px-3 py-2.5",
            isPeek && "opacity-60",
          )}
        >
          {events.map((event) => (
            <div key={event.id} className="w-[180px] shrink-0">
              <EventChip
                event={event}
                compact={isPeek}
                onClick={() => onOpen(event.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventChip({
  event,
  onClick,
  compact = false,
}: {
  event: StoredEvent;
  onClick: () => void;
  compact?: boolean;
}) {
  const style = eventTypeStyle(event.event_type);
  const items = event.action_items;
  const openItems = items.filter((i) => !i.done);
  const visibleItems = items.slice(0, 2);
  const moreCount = items.length - visibleItems.length;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 hover:brightness-95",
        compact ? "px-1.5 py-1" : "px-2.5 py-2",
        style.bg,
        style.border,
      )}
    >
      {!compact && (
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
          {event.is_all_day ? "all day" : formatTime(event.start_time)}
        </div>
      )}
      <div
        className={cn(
          "font-medium leading-snug text-ink text-[11px]",
          compact ? "line-clamp-2" : "mt-0.5",
        )}
      >
        {event.title}
      </div>
      {!compact && event.location && (
        <div className="mt-0.5 text-[10px] leading-snug text-ink-soft">
          {event.location}
        </div>
      )}

      {compact && items.length > 0 && (
        <div className="mt-0.5 font-mono text-[10px] text-ink-mute">
          {openItems.length}/{items.length}
        </div>
      )}

      {!compact && items.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-ink/10 pt-1.5">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-1 text-[10px] leading-snug",
                item.done && "text-ink-mute line-through",
                !item.done && item.urgent && "text-warm",
                !item.done && !item.urgent && "text-ink-soft",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-[3px] inline-block size-1.5 shrink-0 rounded-[1px] border",
                  item.done
                    ? "border-ink-mute bg-ink-mute"
                    : item.urgent
                      ? "border-warm"
                      : "border-ink-mute/60",
                )}
              />
              <span className="line-clamp-1">{item.description}</span>
            </li>
          ))}
          {moreCount > 0 && (
            <li className="font-mono text-[9px] text-ink-mute">
              +{moreCount} more
            </li>
          )}
        </ul>
      )}
    </button>
  );
}

function EmptyBody() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-10 py-16 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-alt font-display text-4xl italic text-ink-mute">
        w
      </div>
      <div>
        <div className="mb-1 text-heading text-ink">Your week awaits</div>
        <p className="max-w-xs text-meta leading-relaxed">
          No events this week. Forward an email or paste a thread — the
          calendar fills in here.
        </p>
      </div>
    </div>
  );
}
