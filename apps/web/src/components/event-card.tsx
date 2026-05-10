import type { StoredEvent } from "@/lib/types/events";
import { formatRange } from "@/lib/utils/date";

export default function EventCard({ event }: { event: StoredEvent }) {
  return (
    <article className="rounded-md border border-input bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-medium">{event.title}</h2>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {event.event_type}
          </p>
        </div>
        <p className="text-right text-sm text-muted-foreground">
          {formatRange({
            start: event.start_time,
            end: event.end_time,
            allDay: event.is_all_day,
          })}
        </p>
      </div>

      {event.location && (
        <p className="mt-2 text-sm text-muted-foreground">{event.location}</p>
      )}
      {event.description && <p className="mt-2 text-sm">{event.description}</p>}

      {event.action_items.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {event.action_items.map((item) => (
            <li key={item.id}>
              {item.urgent && (
                <span className="mr-1 font-medium text-destructive">Urgent:</span>
              )}
              {item.description}
              {item.cost_estimate_gbp != null && (
                <span className="text-muted-foreground"> (£{item.cost_estimate_gbp})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
