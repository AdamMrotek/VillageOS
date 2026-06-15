"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/api-fetch";
import type {
  ExtractInput,
  ExtractResponse,
  ParentEvent,
  StoredEvent,
} from "@/lib/types/events";

export const EVENTS_KEY = ["events"] as const;

export function useEvents() {
  return useQuery({
    queryKey: EVENTS_KEY,
    queryFn: () => apiClient<StoredEvent[]>("/api/events"),
  });
}

export function useExtractEvent() {
  return useMutation({
    mutationFn: ({ rawText, imageDataUrl }: ExtractInput) =>
      apiClient<ExtractResponse>("/api/extract", {
        method: "POST",
        body: JSON.stringify({
          raw_text: rawText ?? null,
          image_data_url: imageDataUrl ?? null,
        }),
      }),
    // A 429 is the per-identity daily quota, not a failure — EventExtraction
    // surfaces it as a persistent sign-up banner, so stay silent here (no
    // toast). Other errors still get the generic toast.
    meta: { suppressErrorToast: true },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) return;
      toast.error("Couldn't extract the event. Please try again.");
    },
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (event: ParentEvent) =>
      apiClient("/api/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: EVENTS_KEY }),
    meta: { errorMessage: "Couldn't create the event. Please try again." },
  });
}

export function useToggleActionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, done }: { itemId: string; done: boolean }) =>
      apiClient(`/api/action_items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ done }),
      }),
    onMutate: async ({ itemId, done }) => {
      await qc.cancelQueries({ queryKey: EVENTS_KEY });
      const prev = qc.getQueryData<StoredEvent[]>(EVENTS_KEY);
      qc.setQueryData<StoredEvent[]>(EVENTS_KEY, (events) =>
        events?.map((e) => ({
          ...e,
          action_items: e.action_items.map((i) =>
            i.id === itemId ? { ...i, done } : i,
          ),
        })),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(EVENTS_KEY, ctx.prev);
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/api/events/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: EVENTS_KEY }),
  });
}
