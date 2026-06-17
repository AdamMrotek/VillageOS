"use client";

import { useQuery } from "@tanstack/react-query";
import { authUserQuery } from "@/lib/hooks/use-auth-user";

/** True when the current session is a demo account — Supabase anonymous
 *  users (created by "Try the demo") carry `is_anonymous=true`. Drives the
 *  demo→sign-up vs free→upgrade messaging. Cosmetic only.
 *
 *  A selector over the shared auth-user query: no extra getUser() call, and it
 *  stays in step with useAuthUser/useRole. */
export function useIsDemo() {
  return useQuery({
    ...authUserQuery,
    select: (user) => user?.is_anonymous ?? false,
  });
}
