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

const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Presign + upload a cover to S3 (≤5 MB), returning the CloudFront URL to
 *  persist on the profile. The bytes go straight to S3, never through our API. */
export async function uploadProviderCover(file: File): Promise<string> {
  if (file.size > MAX_COVER_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const { url, fields, image_url } = await apiClient<{
    url: string;
    fields: Record<string, string>;
    image_url: string;
    max_bytes: number;
  }>("/api/providers/me/cover-upload-url", {
    method: "POST",
    body: JSON.stringify({ content_type: file.type }),
  });

  // Multipart POST straight to S3: append the signed policy fields first and the
  // file LAST (S3 requires it). Don't set Content-Type — the browser adds the
  // multipart boundary itself.
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", file);

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
  return image_url;
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
