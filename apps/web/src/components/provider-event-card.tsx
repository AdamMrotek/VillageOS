import { CALENDAR_LOCALE } from "@/lib/config/calendar";
import { eventTypeStyle } from "@/lib/event-styles";
import type {
  ProviderEventStatus,
  StoredProviderEvent,
} from "@/lib/types/provider-events";
import { formatTime } from "@/lib/utils/date";

const STATUS_LABELS: Record<ProviderEventStatus, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
};

const STATUS_CLASSES: Record<ProviderEventStatus, string> = {
  draft: "border-input bg-surface text-ink-soft",
  published: "border-accent/40 bg-accent-soft text-ink",
  cancelled: "border-destructive/40 bg-surface text-destructive",
};

export function EventStatusBadge({ status }: { status: ProviderEventStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** "Fri 20 Nov · 16:00 – 17:00", or just the date for an all-day event. */
export function formatEventWhen(
  event: Pick<StoredProviderEvent, "start_time" | "end_time" | "is_all_day">,
): string {
  const start = new Date(event.start_time);
  const day = start.toLocaleDateString(CALENDAR_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (event.is_all_day) return `${day} · All day`;
  const time = event.end_time
    ? `${formatTime(start)} – ${formatTime(event.end_time)}`
    : formatTime(start);
  return `${day} · ${time}`;
}

/** One event as a parent sees it on a provider's page. `footer` is where the
 *  owner's actions go on the provider's own list. */
export default function ProviderEventCard({
  event,
  showStatus = false,
  footer,
}: {
  event: StoredProviderEvent;
  /** Show the draft/published badge (owner view). A cancelled badge always shows. */
  showStatus?: boolean;
  footer?: React.ReactNode;
}) {
  const cancelled = event.status === "cancelled";
  return (
    <article
      className={`rounded-lg border border-input bg-surface p-4 ${eventTypeStyle(event.event_type).border}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className={`min-w-0 break-words text-body font-medium text-ink ${cancelled ? "line-through decoration-ink-mute" : ""}`}
        >
          {event.title}
        </h3>
        {(showStatus || cancelled) && <EventStatusBadge status={event.status} />}
      </div>
      <p className="mt-1 text-sm text-ink-soft">{formatEventWhen(event)}</p>
      {event.location && (
        <p className="text-sm text-ink-soft">{event.location}</p>
      )}
      {event.description && (
        <p className="mt-2 text-sm text-ink-soft">{event.description}</p>
      )}
      <p className="mt-2 text-xs text-ink-mute">
        {event.capacity === null
          ? "Unlimited spots"
          : `${event.capacity} ${event.capacity === 1 ? "spot" : "spots"}`}
      </p>
      {footer && <div className="mt-3 flex flex-wrap gap-2">{footer}</div>}
    </article>
  );
}
