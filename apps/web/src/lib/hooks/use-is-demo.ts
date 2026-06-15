"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** True when the current session is a demo account — Supabase anonymous
 *  users (created by "Try the demo") carry `is_anonymous=true`. Drives the
 *  demo→sign-up vs free→upgrade messaging. Cosmetic only. */
export function useIsDemo() {
  return useQuery({
    queryKey: ["is-demo"],
    queryFn: async (): Promise<boolean> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.is_anonymous ?? false;
    },
    staleTime: Infinity,
  });
}
