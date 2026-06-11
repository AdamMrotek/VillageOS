import type { ParentEvent } from "@/lib/types/events";

/**
 * Per-field diff between the extracted draft and the event the user actually
 * created — the primary metric for the extraction model A/B (move 1). Returns
 * the names of the fields the user changed.
 *
 * `confidence` is excluded: the form hardcodes it to 1.0 on submit, so it's
 * never a user edit and would always read as "changed".
 */

/** Epoch *minutes*, or null. The new-event form round-trips datetimes through a
 *  `datetime-local` input (isoToLocalInput → toIsoOrNull) which drops seconds,
 *  so a raw string compare would flag an untouched start_time/end_time as
 *  edited. Compare to the minute instead. */
function toEpochMinute(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 60_000);
}

/** Treat null and "" as the same (empty), trimmed — the form coalesces blank
 *  optional fields to null, so "" vs null is not a real edit. */
function normText(s: string | null): string {
  return (s ?? "").trim();
}

function actionItemsKey(items: ParentEvent["action_items"]): string {
  return items
    .map((i) => `${i.description.trim()}|${i.cost_estimate_gbp ?? ""}|${i.urgent}`)
    .join("§");
}

const FIELD_COMPARATORS: Record<string, (e: ParentEvent) => unknown> = {
  title: (e) => e.title.trim(),
  event_type: (e) => e.event_type,
  start_time: (e) => toEpochMinute(e.start_time),
  end_time: (e) => toEpochMinute(e.end_time),
  is_all_day: (e) => e.is_all_day,
  location: (e) => normText(e.location),
  description: (e) => normText(e.description),
  action_items: (e) => actionItemsKey(e.action_items),
};

export function diffExtractionFields(
  draft: ParentEvent,
  submitted: ParentEvent,
): string[] {
  return Object.entries(FIELD_COMPARATORS)
    .filter(([, get]) => get(draft) !== get(submitted))
    .map(([field]) => field);
}
