import type { EventType } from "@/lib/types/events";

export type ProviderEventStatus = "draft" | "published" | "cancelled";

// Mirrors ProviderEventInput in apps/api/app/schemas/provider_events.py. Title
// and description share EVENT_FIELD_LIMITS with a parent's own events.
export type ProviderEventInput = {
  title: string;
  event_type: EventType;
  start_time: string;
  end_time: string | null;
  is_all_day: boolean;
  location: string | null;
  description: string | null;
  /** Spots available; null = unlimited. */
  capacity: number | null;
};

export type StoredProviderEvent = ProviderEventInput & {
  id: string;
  provider_id: string;
  status: ProviderEventStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

/** An edit to an existing event. `notify_attendees` is the "Notify attendees"
 *  box: unticked, a time or place change queues no email. */
export type ProviderEventUpdate = ProviderEventInput & {
  notify_attendees: boolean;
};

/** An event in a listing, with how full it is. `my_spots` is the viewer's own
 *  confirmed reservation (0 = not reserved). */
export type ListedProviderEvent = StoredProviderEvent & {
  spots_taken: number;
  my_spots: number;
};

// Mirrors MAX_SPOTS in apps/api/app/schemas/reservations.py.
export const MAX_SPOTS_PER_RESERVATION = 10;
