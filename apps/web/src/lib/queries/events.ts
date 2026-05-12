"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { StoredEvent } from "@/lib/types/events";

export const EVENTS_KEY = ["events"] as const;

export function useEvents() {
  return useQuery({
    queryKey: EVENTS_KEY,
    queryFn: () => apiClient<StoredEvent[]>("/api/events"),
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
