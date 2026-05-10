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

export type ActionItemInput = {
  description: string;
  cost_estimate_gbp: number | null;
  urgent: boolean;
};

export type ActionItem = ActionItemInput & {
  id: string;
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
