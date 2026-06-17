"use client";

import { useEffect } from "react";
import {
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type AppRole = "parent" | "provider" | "admin";

/** Shared query for the current verified user. One getUser() call backs the
 *  whole app — useIsDemo/useRole are selectors over this same cache entry, so
 *  they neither refetch nor drift out of sync with each other. */
export const authUserQuery = queryOptions({
  queryKey: ["auth-user"] as const,
  queryFn: async (): Promise<User | null> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  },
  staleTime: Infinity,
});

/** App role from the session's user_metadata (set at sign-up). Defaults to
 *  "parent". Cosmetic only — RLS is the real authorization boundary. */
export function roleOf(user: User | null): AppRole {
  const role = user?.user_metadata?.role;
  return role === "provider" || role === "admin" ? role : "parent";
}

/**
 * Central client-side auth state. Reads the shared verified-user query and
 * keeps it live via an onAuthStateChange subscription, so sign-in, sign-out,
 * anonymous demo sign-in, and token refresh all propagate across the app
 * without a manual refetch in each flow.
 *
 * Mounted app-wide through the top-nav UserMenu; the selector hooks
 * (useIsDemo, useRole) ride the same cache entry it keeps fresh.
 */
export function useAuthUser() {
  const queryClient = useQueryClient();
  const query = useQuery(authUserQuery);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      queryClient.setQueryData(authUserQuery.queryKey, session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  const user = query.data ?? null;
  return {
    user,
    isLoading: query.isLoading,
    isAuthenticated: !!user,
    isDemo: user?.is_anonymous ?? false,
    role: roleOf(user),
  };
}
