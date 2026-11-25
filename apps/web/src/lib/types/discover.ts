import type { ListedProviderEvent } from "@/lib/types/provider-events";
import type {
  ProviderCategory,
  StoredProviderProfile,
} from "@/lib/types/providers";

// Mirrors apps/api/app/schemas/discover.py.

/** The kind chips at the top of the page. */
export type DiscoverKind = "all" | "event" | "venue" | "entertainer";

/** An event card: the event, how full it is, and who runs it. */
export type DiscoverEvent = ListedProviderEvent & {
  provider_name: string | null;
  provider_category: ProviderCategory | null;
};

export type DiscoverRow =
  | { id: string; title: string; item_type: "event"; items: DiscoverEvent[] }
  | {
      id: string;
      title: string;
      item_type: "provider";
      items: StoredProviderProfile[];
    };

export type DiscoverFeatured =
  | { item_type: "event"; item: DiscoverEvent }
  | { item_type: "provider"; item: StoredProviderProfile };

/** The browse page. The page renders whatever rows it is given, in order;
 *  empty rows are never sent. */
export type DiscoverHome = {
  featured: DiscoverFeatured | null;
  rows: DiscoverRow[];
};
