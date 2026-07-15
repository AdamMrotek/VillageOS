import { apiClient } from "@/lib/api-client";

/**
 * Fire-and-forget funnel capture → POST /api/analytics/events. Replaces the
 * PostHog client (dropped 2026-06-26). The server stamps `distinct_id` from the
 * JWT, so we only send the event name + properties. Never throws or blocks:
 * telemetry must not break the extraction UX, and a failed send is dropped.
 */
export function track(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  void apiClient("/api/analytics/events", {
    method: "POST",
    body: JSON.stringify({ event, properties }),
  }).catch(() => {
    // best-effort — swallow network/auth errors
  });
}
