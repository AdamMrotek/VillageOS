"use client";

import { useState } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { toast } from "sonner";

const DEFAULT_FETCH_ERROR = "Couldn't load your data. Please try again.";
const DEFAULT_MUTATION_ERROR = "Something went wrong. Please try again.";

// `meta` controls the centralized error toast for any query/mutation:
//   meta: { errorMessage: "Couldn't delete the event" }  // custom copy
//   meta: { suppressErrorToast: true }                    // handle it yourself
type ErrorToastMeta = {
  errorMessage?: string;
  suppressErrorToast?: boolean;
};

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: ErrorToastMeta;
    mutationMeta: ErrorToastMeta;
  }
}

export default function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        // Surface a toast whenever a query fails. The raw error from
        // `authedFetch` looks like `API 500: ...`, so we show a friendly
        // default (or a per-query override) instead of leaking internals.
        queryCache: new QueryCache({
          onError: (_error, query) => {
            if (query.meta?.suppressErrorToast) return;
            toast.error(query.meta?.errorMessage ?? DEFAULT_FETCH_ERROR);
          },
        }),
        // Same treatment for mutations (toggle/delete/create). Optimistic
        // updates already roll back in their own onError; this just notifies.
        mutationCache: new MutationCache({
          onError: (_error, _vars, _ctx, mutation) => {
            if (mutation.meta?.suppressErrorToast) return;
            toast.error(mutation.meta?.errorMessage ?? DEFAULT_MUTATION_ERROR);
          },
        }),
        defaultOptions: {
          // `networkMode: "always"` makes requests fire even when the browser
          // reports offline. The default ("online") *pauses* queries/mutations
          // while offline — they never run, never error, and sit in `pending`
          // forever (loading spinner with no toast). We'd rather attempt the
          // request, let it fail, and surface the error toast.
          queries: {
            networkMode: "always",
            staleTime: 30_000,
            refetchOnWindowFocus: true,
          },
          mutations: {
            networkMode: "always",
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
