export const EVENT_TYPES = [
  "school",
  "sport",
  "birthday",
  "fundraiser",
  "meeting",
  "deadline",
  "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// Field length limits — keep in sync with API validation
// (apps/api/app/schemas/events.py) and the events_* CHECK constraints
// in supabase/migrations.
export const EVENT_FIELD_LIMITS = {
  title: 60,
  description: 240,
} as const;

export type ActionItemInput = {
  description: string;
  cost_estimate_gbp: number | null;
  urgent: boolean;
};

export type ActionItem = ActionItemInput & {
  id: string;
  done: boolean;
};

export type ParentEvent = {
  title: string;
  event_type: EventType;
  start_time: string;
  end_time: string | null;
  is_all_day: boolean;
  location: string | null;
  description: string | null;
  confidence: number;
  action_items: ActionItemInput[];
};

/** The fields a parent plans around, as a provider's event was at an earlier
 *  version. Mirrors EventSnapshot in apps/api/app/schemas/events.py. */
export type EventSnapshot = {
  start_time: string;
  end_time: string | null;
  is_all_day: boolean;
  location: string | null;
  status: string;
};

/** What a calendar entry carries when it is a reserved provider event. */
export type ReservedEventInfo = {
  reservation_id: string;
  spots: number;
  provider_id: string;
  provider_name: string | null;
  cancelled: boolean;
  /** The provider made a material change the parent hasn't opened yet;
   *  `previous` is then the state the parent last saw. */
  updated: boolean;
  previous: EventSnapshot | null;
};

export type StoredEvent = Omit<ParentEvent, "action_items"> & {
  id: string;
  action_items: ActionItem[];
  /** "own" = the parent's own event. "provider" = a provider's event they
   *  reserved: read-only, `id` is the provider event's id, `reservation` set. */
  source: "own" | "provider";
  reservation: ReservedEventInfo | null;
};

export type ExtractResponse = {
  event: ParentEvent;
  model_used: string;
  tokens_used: number;
};

// At least one of the two must be present (the API enforces it). With an image
// attached, rawText is an optional caption and the 10-char floor doesn't apply.
export type ExtractInput = {
  rawText?: string;
  imageDataUrl?: string;
};

export type ExtractionInputType = "text" | "image" | "text+image";
