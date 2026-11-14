"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/api-fetch";
import type {
  ProviderEventInput,
  StoredProviderEvent,
} from "@/lib/types/provider-events";

export const MY_PROVIDER_EVENTS_KEY = ["my-provider-events"] as const;
export const PROVIDER_EVENTS_KEY = ["provider-events"] as const;

/** Every event the signed-in provider owns, drafts included. */
export function useMyProviderEvents() {
  return useQuery({
    queryKey: MY_PROVIDER_EVENTS_KEY,
    queryFn: () =>
      apiClient<StoredProviderEvent[]>("/api/providers/me/events"),
  });
}

/** A provider's upcoming published (and cancelled) events — the parent view. */
export function useProviderEvents(providerId: string) {
  return useQuery({
    queryKey: [...PROVIDER_EVENTS_KEY, providerId],
    queryFn: () =>
      apiClient<StoredProviderEvent[]>(`/api/providers/${providerId}/events`),
    enabled: !!providerId,
  });
}

// A 409 from these endpoints carries a sentence written for the provider
// ("Only a draft can be deleted — cancel the event instead"), so show it
// as-is; anything else gets the generic fallback.
function toastError(fallback: string) {
  return (error: unknown) => {
    toast.error(
      error instanceof ApiError && error.status === 409
        ? error.detail
        : fallback,
    );
  };
}

function useInvalidateEvents() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: MY_PROVIDER_EVENTS_KEY });
    qc.invalidateQueries({ queryKey: PROVIDER_EVENTS_KEY });
  };
}

export function useCreateProviderEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (event: ProviderEventInput) =>
      apiClient<StoredProviderEvent>("/api/providers/me/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    onSuccess: invalidate,
    meta: { suppressErrorToast: true },
    onError: toastError("Couldn't create the event. Please try again."),
  });
}

export function useUpdateProviderEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, event }: { id: string; event: ProviderEventInput }) =>
      apiClient<StoredProviderEvent>(`/api/providers/me/events/${id}`, {
        method: "PUT",
        body: JSON.stringify(event),
      }),
    onSuccess: invalidate,
    meta: { suppressErrorToast: true },
    onError: toastError("Couldn't save the event. Please try again."),
  });
}

export type ProviderEventAction = "publish" | "unpublish" | "cancel";

/** Move an event between draft / published / cancelled. */
export function useProviderEventAction() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ProviderEventAction }) =>
      apiClient<StoredProviderEvent>(
        `/api/providers/me/events/${id}/${action}`,
        { method: "POST" },
      ),
    // Also refetch on failure: a 409 means the list on screen is stale.
    onSettled: invalidate,
    meta: { suppressErrorToast: true },
    onError: toastError("Couldn't update the event. Please try again."),
  });
}

export function useDeleteProviderEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/api/providers/me/events/${id}`, { method: "DELETE" }),
    onSettled: invalidate,
    meta: { suppressErrorToast: true },
    onError: toastError("Couldn't delete the event. Please try again."),
  });
}
