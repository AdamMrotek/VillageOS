export type ProviderCategory =
  | "school"
  | "sports_club"
  | "community"
  | "council"
  | "library"
  | "other";

/** How parents use a provider, separate from its category (sector). Mirrors
 *  ProviderKind in apps/api/app/schemas/providers.py. */
export type ProviderKind = "venue" | "organiser" | "entertainer";

export type ProviderProfileInput = {
  name: string;
  category: ProviderCategory;
  kind: ProviderKind;
  description: string | null;
  location: string | null;
  website: string | null;
  image_url: string | null;
  tags: string[];
};

export type StoredProviderProfile = ProviderProfileInput & {
  user_id: string;
  created_at: string;
  updated_at: string;
};
