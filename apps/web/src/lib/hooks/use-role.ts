"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type AppRole = "parent" | "provider" | "admin";

/** App role from the session's user_metadata (set at sign-up). Defaults to
 *  "parent". Cosmetic only — RLS is the real authorization boundary. */
export function useRole() {
  return useQuery({
    queryKey: ["app-role"],
    queryFn: async (): Promise<AppRole> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const role = user?.user_metadata?.role;
      return role === "provider" || role === "admin" ? role : "parent";
    },
    staleTime: Infinity,
  });
}
