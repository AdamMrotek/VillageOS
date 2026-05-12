import type { EventType } from "@/lib/types/events";

export type EventTypeStyle = {
  label: string;
  dot: string;
  bg: string;
  border: string;
};

export const EVENT_TYPE_STYLES: Record<EventType, EventTypeStyle> = {
  school: {
    label: "School",
    dot: "bg-[hsl(214_32%_52%)]",
    bg: "bg-[hsl(214_28%_91%)]",
    border: "border-l-[3px] border-l-[hsl(214_32%_52%)]",
  },
  sport: {
    label: "Sport",
    dot: "bg-accent",
    bg: "bg-accent-soft",
    border: "border-l-[3px] border-l-accent",
  },
  birthday: {
    label: "Birthday",
    dot: "bg-[hsl(350_42%_55%)]",
    bg: "bg-[hsl(350_34%_91%)]",
    border: "border-l-[3px] border-l-[hsl(350_42%_55%)]",
  },
  fundraiser: {
    label: "Fundraiser",
    dot: "bg-warm",
    bg: "bg-warm-surface",
    border: "border-l-[3px] border-l-warm",
  },
  meeting: {
    label: "Meeting",
    dot: "bg-[hsl(150_14%_42%)]",
    bg: "bg-[hsl(150_10%_88%)]",
    border: "border-l-[3px] border-l-[hsl(150_14%_42%)]",
  },
  deadline: {
    label: "Deadline",
    dot: "bg-[hsl(14_46%_48%)]",
    bg: "bg-[hsl(14_40%_90%)]",
    border: "border-l-[3px] border-l-[hsl(14_46%_48%)]",
  },
  other: {
    label: "Other",
    dot: "bg-ink-mute",
    bg: "bg-surface-alt",
    border: "border-l-[3px] border-l-ink-mute",
  },
};

export function eventTypeStyle(type: EventType): EventTypeStyle {
  return EVENT_TYPE_STYLES[type] ?? EVENT_TYPE_STYLES.other;
}
