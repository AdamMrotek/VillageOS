"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/popover";
import { createClient } from "../lib/supabase";
import { useAuthUser } from "../hooks/use-auth-user";

/** Avatar popover with the signed-in email, an optional settings link and sign
 *  out. Requires a react-query provider (it reads useAuthUser). Demo (anonymous)
 *  sessions never see the settings link — they have no account to manage. */
export default function UserMenu({
  settingsHref = "/settings",
  signOutHref = "/",
}: {
  /** Where the Settings item links; pass null to omit it entirely. */
  settingsHref?: string | null;
  /** Where to land after signing out. */
  signOutHref?: string;
}) {
  const router = useRouter();
  const { user, isDemo } = useAuthUser();
  const email = user?.email ?? null;
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(signOutHref);
    router.refresh();
  }

  const initial = email?.trim().charAt(0).toUpperCase() || "?";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Account menu"
        className="grid h-9 w-9 place-items-center rounded-full bg-ink text-surface font-display text-sm leading-none transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initial}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        {email && (
          <p className="truncate px-2.5 py-2 text-sm text-ink-soft" title={email}>
            {email}
          </p>
        )}
        {settingsHref && !isDemo && (
          <Link
            href={settingsHref}
            onClick={() => setOpen(false)}
            className="block rounded-sm px-2.5 py-2 text-body text-ink transition-colors hover:bg-accent"
          >
            Settings
          </Link>
        )}
        <button
          onClick={handleSignOut}
          className="block w-full rounded-sm px-2.5 py-2 text-left text-body text-ink transition-colors hover:bg-accent"
        >
          Sign out
        </button>
      </PopoverContent>
    </Popover>
  );
}
