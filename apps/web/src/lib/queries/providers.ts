"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  ProviderProfileInput,
  StoredProviderProfile,
} from "@/lib/types/providers";

export const PROVIDERS_KEY = ["providers"] as const;
export const MY_PROVIDER_KEY = ["my-provider"] as const;

/** Public directory search. Empty query returns the full list. */
export function useProviders(q: string) {
  return useQuery({
    queryKey: [...PROVIDERS_KEY, q],
    queryFn: () =>
      apiClient<StoredProviderProfile[]>(
        `/api/providers${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
  });
}

export function useProvider(userId: string) {
  return useQuery({
    queryKey: [...PROVIDERS_KEY, "detail", userId],
    queryFn: () =>
      apiClient<StoredProviderProfile>(`/api/providers/${userId}`),
    enabled: !!userId,
  });
}

/** The signed-in provider's own profile (null until they create one). */
export function useMyProvider() {
  return useQuery({
    queryKey: MY_PROVIDER_KEY,
    queryFn: () =>
      apiClient<StoredProviderProfile | null>("/api/providers/me"),
  });
}

export function useUpdateMyProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: ProviderProfileInput) =>
      apiClient<StoredProviderProfile>("/api/providers/me", {
        method: "PUT",
        body: JSON.stringify(profile),
      }),
    onSuccess: (data) => {
      qc.setQueryData(MY_PROVIDER_KEY, data);
      qc.invalidateQueries({ queryKey: PROVIDERS_KEY });
    },
    meta: { errorMessage: "Couldn't save your details. Please try again." },
  });
}
