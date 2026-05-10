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

export type ActionItem = {
  id: string;
  description: string;
  cost_estimate_gbp: number | null;
  urgent: boolean;
};

export type StoredEvent = {
  id: string;
  title: string;
  event_type: EventType;
  start_time: string;
  end_time: string | null;
  is_all_day: boolean;
  location: string | null;
  description: string | null;
  confidence: number;
  action_items: ActionItem[];
};
