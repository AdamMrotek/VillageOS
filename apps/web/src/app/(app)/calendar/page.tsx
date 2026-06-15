import Link from "next/link";
import WeekGrid from "@/components/week-grid";
import PrepList from "@/components/prep-list";
import MonthCalendar from "@/components/month-calendar";
import MonthCalendarPopover from "@/components/month-calendar-popover";
import PageLayout from "@/components/page-layout";
import EventDetailSheet from "@/components/event-detail-sheet";

export default function CalendarPage() {
  return (
    <PageLayout
      title="Calendar"
      action={
        <div className="flex items-center gap-2">
          <Link
            href="/calendar/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            New event
          </Link>
          <MonthCalendarPopover />
        </div>
      }
    >
      <EventDetailSheet />
      <div className="grid gap-4 sm:grid-cols-[300px_1fr]">
        <div className="hidden sm:block">
          <MonthCalendar />
        </div>
        <PrepList />
      </div>
      <WeekGrid />
    </PageLayout>
  );
}
