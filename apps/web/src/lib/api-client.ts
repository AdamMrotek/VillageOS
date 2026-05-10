import { createClient } from "@/lib/supabase/client";
import { authedFetch } from "@/lib/api-fetch";

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return authedFetch(session?.access_token, path, init);
}
