"use client";

import { useRouter } from "next/navigation";
import { Button } from "@repo/ui/components/button";
import { createClient } from "@repo/ui/lib/supabase";

/** Full-height loading / not-authorised / error screens shared by the admin
 *  pages. Render this for any non-"ready" Resource state. */
export function GateScreen({
  state,
}: {
  state:
    | { status: "loading" }
    | { status: "forbidden" }
    | { status: "error"; message: string };
}) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  if (state.status === "loading") {
    return (
      <main className="mx-auto flex min-h-svh max-w-3xl items-center justify-center px-5">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (state.status === "forbidden") {
    return (
      <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center gap-2 px-5 text-center">
        <h1 className="text-xl font-semibold">Not authorised</h1>
        <p className="text-sm text-muted-foreground">
          This account isn’t an admin.
        </p>
        <Button variant="link" onClick={signOut}>
          Sign out
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center gap-2 px-5 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-destructive">{state.message}</p>
    </main>
  );
}
