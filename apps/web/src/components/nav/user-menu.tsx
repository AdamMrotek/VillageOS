"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { createClient } from "@/lib/supabase/client";
import { useIsDemo } from "@/lib/hooks/use-is-demo";

export default function UserMenu() {
  const router = useRouter();
  const { data: isDemo } = useIsDemo();
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
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
        {!isDemo && (
          <Link
            href="/settings"
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
