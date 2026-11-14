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
