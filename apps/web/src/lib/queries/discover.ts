"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { DiscoverHome, DiscoverKind } from "@/lib/types/discover";

export const DISCOVER_KEY = ["discover"] as const;

/** The browse page's featured item and rows for the selected kind chip. */
export function useDiscoverHome(kind: DiscoverKind) {
  return useQuery({
    queryKey: [...DISCOVER_KEY, "home", kind],
    queryFn: () =>
      apiClient<DiscoverHome>(`/api/discover/home?kind=${kind}`),
    // Switching chips keeps the old rows on screen until the new ones arrive.
    placeholderData: keepPreviousData,
  });
}
