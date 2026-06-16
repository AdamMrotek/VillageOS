"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@repo/ui/components/button";
import { createClient } from "@/lib/supabase/client";
import { deleteAccount } from "@/lib/api-client";
import { useIsDemo } from "@/lib/hooks/use-is-demo";

export default function SettingsPage() {
  const router = useRouter();
  const { data: isDemo } = useIsDemo();
  const [email, setEmail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Demo (anonymous) sessions have no account to manage — bounce them out.
  useEffect(() => {
    if (isDemo) router.replace("/calendar");
  }, [isDemo, router]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  if (isDemo) return null;

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteAccount();
      // The account (and its session) is gone server-side; clear the local
      // session too, then send them back to the landing page.
      await createClient().auth.signOut();
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong deleting your account. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-10 py-12">
      <div className="space-y-1">
        <h1 className="font-display text-2xl tracking-tight text-ink">Settings</h1>
        <p className="text-body text-ink-soft">
          Manage your account and your data.
        </p>
      </div>

      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-medium text-ink">Profile</h2>
        <dl className="rounded-md border border-hairline bg-surface p-5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-body text-ink-soft">Email</dt>
            <dd className="text-body text-ink">{email ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-sm font-medium text-ink">Security</h2>
        <div className="flex items-center justify-between gap-4 rounded-md border border-hairline bg-surface p-5">
          <div>
            <p className="text-body text-ink">Password</p>
            <p className="text-sm text-ink-soft">
              Change the password you use to sign in.
            </p>
          </div>
          <Link
            href="/settings/password"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Change password
          </Link>
        </div>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-sm font-medium text-ink">Danger zone</h2>
        <div className="rounded-md border border-destructive/30 bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-body text-ink">Delete account</p>
              <p className="text-sm text-ink-soft">
                Permanently delete your account and all your data — calendar
                events, action items and profile. This cannot be undone.
              </p>
            </div>
            {!confirming && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirming(true)}
              >
                Delete account
              </Button>
            )}
          </div>

          {confirming && (
            <div className="mt-5 space-y-3 border-t border-hairline pt-5">
              <p className="text-body text-ink">
                Are you sure? This permanently erases everything and can&apos;t be
                undone.
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex items-center gap-3">
                <Button
                  variant="destructive"
                  size="sm"
                  loading={deleting}
                  onClick={handleDelete}
                >
                  Yes, delete everything
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
