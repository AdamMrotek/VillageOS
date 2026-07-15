"use client";

import { useQuery } from "@tanstack/react-query";
import { authUserQuery, roleOf, type AppRole } from "@repo/ui/hooks/use-auth-user";

export type { AppRole };

/** App role from the session's user_metadata (set at sign-up). Defaults to
 *  "parent". Cosmetic only — RLS is the real authorization boundary.
 *
 *  A selector over the shared auth-user query: no extra getUser() call, and it
 *  stays in step with useAuthUser/useIsDemo. */
export function useRole() {
  return useQuery({
    ...authUserQuery,
    select: roleOf,
  });
}
