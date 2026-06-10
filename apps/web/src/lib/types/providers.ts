export type ProviderCategory =
  | "school"
  | "sports_club"
  | "community"
  | "council"
  | "library"
  | "other";

export type ProviderProfileInput = {
  name: string;
  category: ProviderCategory;
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
