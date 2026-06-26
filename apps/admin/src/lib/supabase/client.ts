import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client — same project as apps/web, so an admin signs in with
 *  their normal VillageOS account. Authorization is enforced server-side by the
 *  API's require_admin (role read from the profiles table); this client only
 *  obtains the session token to send. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
