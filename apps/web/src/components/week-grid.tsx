"use client";

import { useState } from "react";
import { cn } from "@repo/ui/lib/utils";
import type { StoredEvent } from "@/lib/types/events";
import { addDays, formatTime, isSameDay } from "@/lib/utils/date";
import EventDetailSheet from "@/components/event-detail-sheet";

type Tone = "accent" | "warm" | "default";

function eventTone(event: StoredEvent): Tone {
  if (event.action_items.some((item) => item.urgent && !item.done)) return "warm";
  if (event.event_type === "deadline" || event.event_type === "fundraiser") return "warm";
  if (event.event_type === "birthday" || event.event_type === "sport") return "accent";
  return "default";
}

const TONE_BG: Record<Tone, string> = {
  accent: "bg-accent-soft",
  warm: "bg-warm-surface",
  default: "bg-surface-alt",
};

const TONE_BORDER: Record<Tone, string> = {
  accent: "border-l-2 border-l-accent",
  warm: "border-l-2 border-l-warm",
  default: "border-l-2 border-l-ink-mute",
};

export default function WeekGrid({
  events,
  anchorDay,
}: {
  events: StoredEvent[];
  anchorDay?: Date;
}) {
  const anchor = anchorDay ?? new Date();
  const today = new Date();

  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const eventsByDay = days.map((day) =>
    events
      .filter((e) => isSameDay(new Date(e.start_time), day))
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() -
          new Date(b.start_time).getTime(),
      ),
  );

  const totalEvents = eventsByDay.reduce((sum, list) => sum + list.length, 0);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const openEvent = events.find((e) => e.id === openEventId) ?? null;

  const weekLabel = `Week of ${anchor.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  })}`;

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface">
        <GridHeader weekLabel={weekLabel} totalEvents={totalEvents} />

        {totalEvents === 0 ? (
          <EmptyBody />
        ) : (
          <div className="grid grid-cols-7">
            {days.map((day, i) => (
              <DayColumn
                key={day.toISOString()}
                day={day}
                isToday={isSameDay(day, today)}
                events={eventsByDay[i]}
                onOpen={setOpenEventId}
                isLast={i === days.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <EventDetailSheet
        event={openEvent}
        onClose={() => setOpenEventId(null)}
      />
    </>
  );
}

function GridHeader({
  weekLabel,
  totalEvents,
}: {
  weekLabel: string;
  totalEvents: number;
}) {
  return (
    <div className="flex items-start justify-between border-b-2 border-ink px-7 pb-4 pt-6">
      <div>
        <div className="text-eyebrow-accent">This week</div>
        <h2 className="mt-2 whitespace-nowrap text-title text-ink">
          {weekLabel}
        </h2>
      </div>
      <span className="whitespace-nowrap rounded-sm border border-hairline px-2.5 py-1 font-mono text-[11px] text-ink-mute">
        {totalEvents === 0
          ? "—"
          : `${totalEvents} event${totalEvents === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

function DayColumn({
  day,
  isToday,
  events,
  onOpen,
  isLast,
}: {
  day: Date;
  isToday: boolean;
  events: StoredEvent[];
  onOpen: (id: string) => void;
  isLast: boolean;
}) {
  const weekday = day.toLocaleDateString("en-GB", { weekday: "short" });
  const dateNum = day.getDate().toString().padStart(2, "0");

  return (
    <div
      className={cn(
        "flex min-h-[180px] flex-col",
        !isLast && "border-r border-hairline",
      )}
    >
      <div
        className={cn(
          "border-b border-hairline px-3.5 py-3",
          isToday && "bg-ink",
        )}
      >
        <div
          className={cn(
            "text-eyebrow",
            isToday && "text-accent-soft",
          )}
        >
          {weekday}
        </div>
        <div
          className={cn(
            "mt-1 font-display text-[22px] leading-tight tabular-nums tracking-tight",
            isToday ? "text-surface" : "text-ink",
          )}
        >
          {dateNum}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        {events.map((event) => (
          <EventChip
            key={event.id}
            event={event}
            onClick={() => onOpen(event.id)}
          />
        ))}
      </div>
    </div>
  );
}

function EventChip({
  event,
  onClick,
}: {
  event: StoredEvent;
  onClick: () => void;
}) {
  const tone = eventTone(event);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm px-2.5 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 hover:brightness-95",
        TONE_BG[tone],
        TONE_BORDER[tone],
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
        {event.is_all_day ? "all day" : formatTime(event.start_time)}
      </div>
      <div className="mt-0.5 text-[11px] font-medium leading-snug text-ink">
        {event.title}
      </div>
      {event.location && (
        <div className="mt-0.5 text-[10px] leading-snug text-ink-soft">
          {event.location}
        </div>
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
