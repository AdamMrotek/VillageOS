import { createClient } from "@repo/ui/lib/supabase";
import { authedFetch } from "@/lib/api-fetch";

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return authedFetch(session?.access_token, path, init);
}

/** Seed the current (anonymous) session's calendar with demo events.
 *  Idempotent server-side — a no-op if the guest already has events. */
export async function seedDemo(): Promise<{
  seeded: boolean;
  event_count?: number;
}> {
  return apiClient("/api/demo/seed", { method: "POST" });
}

/** Permanently delete the signed-in user's account and all their data.
 *  Cascades server-side across every user-owned table. Irreversible — the
 *  caller is responsible for confirming intent and signing out afterwards. */
export async function deleteAccount(): Promise<void> {
  await apiClient("/api/account", { method: "DELETE" });
}
