"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

// Mirrors Preferences in apps/api/app/schemas/profiles.py.
export type Preferences = {
  /** Email me when an event I reserved is changed or cancelled. */
  event_emails: boolean;
};

export const PREFERENCES_KEY = ["preferences"] as const;

export function usePreferences() {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: () => apiClient<Preferences>("/api/account/preferences"),
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Preferences) =>
      apiClient<Preferences>("/api/account/preferences", {
        method: "PUT",
        body: JSON.stringify(preferences),
      }),
    // Show the new value immediately; put the old one back if saving fails.
    onMutate: async (preferences) => {
      await qc.cancelQueries({ queryKey: PREFERENCES_KEY });
      const previous = qc.getQueryData<Preferences>(PREFERENCES_KEY);
      qc.setQueryData(PREFERENCES_KEY, preferences);
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous) qc.setQueryData(PREFERENCES_KEY, context.previous);
    },
    meta: { errorMessage: "Couldn't save that setting. Please try again." },
  });
}
