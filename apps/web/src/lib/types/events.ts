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

export type StoredEvent = Omit<ParentEvent, "action_items"> & {
  id: string;
  action_items: ActionItem[];
};

export type ExtractResponse = {
  event: ParentEvent;
  model_used: string;
  tokens_used: number;
};
