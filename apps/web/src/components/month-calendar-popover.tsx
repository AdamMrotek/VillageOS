"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import MonthCalendar from "@/components/month-calendar";

export default function MonthCalendarPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open calendar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-hairline bg-surface text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-dark/40 sm:hidden"
        >
          <CalendarIcon />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] border-0 bg-transparent p-0 shadow-xl sm:hidden">
        <MonthCalendar />
      </PopoverContent>
    </Popover>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
    </svg>
  );
}
