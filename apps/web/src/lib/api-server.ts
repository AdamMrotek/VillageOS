import "server-only";

import { createClient } from "@/lib/supabase/server";
import { authedFetch } from "@/lib/api-fetch";

export async function apiServer<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return authedFetch(session?.access_token, path, init);
}
