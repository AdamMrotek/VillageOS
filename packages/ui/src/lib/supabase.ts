import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client shared by every app in the monorepo — web and admin
 *  talk to the same Supabase project, so an admin signs in with their normal
 *  VillageOS account. Authorization is enforced server-side (RLS / the API's
 *  require_admin); this client only obtains the session token to send.
 *
 *  No memoization needed: createBrowserClient caches a module-scoped singleton
 *  in the browser by default, so repeated calls return the same instance. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
