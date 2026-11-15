import { eventTypeStyle } from "@/lib/event-styles";
import type {
  ListedProviderEvent,
  ProviderEventStatus,
} from "@/lib/types/provider-events";
import { formatEventWhen } from "@/lib/utils/event-changes";

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Spots still free, or null when the event has no limit. */
export function spotsLeft(event: ListedProviderEvent): number | null {
  return event.capacity === null
    ? null
    : Math.max(0, event.capacity - event.spots_taken);
}

/** What a parent reads: how many spots they could still take. */
function spotsLeftLabel(event: ListedProviderEvent): string {
  const left = spotsLeft(event);
  if (left === null) return "Unlimited spots";
  if (left === 0) return "Full";
  return `${plural(left, "spot")} left`;
}

/** What the organiser reads: how many spots parents have taken. */
function reservedLabel(event: ListedProviderEvent): string {
  return event.capacity === null
    ? `${event.spots_taken} reserved · unlimited spots`
    : `${event.spots_taken} of ${plural(event.capacity, "spot")} reserved`;
}

/** One event as a parent sees it on a provider's page. `footer` is where the
 *  owner's actions go on the provider's own list. */
export default function ProviderEventCard({
  event,
  showStatus = false,
  footer,
}: {
  event: ListedProviderEvent;
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
        {showStatus ? reservedLabel(event) : spotsLeftLabel(event)}
      </p>
      {footer && <div className="mt-3 flex flex-wrap gap-2">{footer}</div>}
    </article>
  );
}
