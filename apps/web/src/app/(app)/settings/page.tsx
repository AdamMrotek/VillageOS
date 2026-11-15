"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AccountSettings from "@repo/ui/custom_components/account-settings";
import { Checkbox } from "@repo/ui/components/checkbox";
import { deleteAccount } from "@/lib/api-client";
import { useIsDemo } from "@/lib/hooks/use-is-demo";
import {
  usePreferences,
  useUpdatePreferences,
} from "@/lib/queries/preferences";

export default function SettingsPage() {
  const router = useRouter();
  const { data: isDemo } = useIsDemo();

  // Demo (anonymous) sessions have no account to manage — bounce them out.
  useEffect(() => {
    if (isDemo) router.replace("/calendar");
  }, [isDemo, router]);

  if (isDemo) return null;

  return (
    <AccountSettings
      deleteAccount={deleteAccount}
      changePasswordHref="/settings/password"
    >
      <NotificationSettings />
    </AccountSettings>
  );
}

/** Where the "Turn these emails off" link in an event-change email lands. */
function NotificationSettings() {
  const { data: preferences } = usePreferences();
  const update = useUpdatePreferences();

  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-sm font-medium text-ink">Notifications</h2>
      <label className="flex items-start gap-3 rounded-md border border-hairline bg-surface p-5">
        <Checkbox
          checked={preferences?.event_emails ?? false}
          disabled={!preferences}
          onCheckedChange={(checked) =>
            update.mutate({ event_emails: checked === true })
          }
          className="mt-0.5 bg-surface"
        />
        <span>
          <span className="block text-body text-ink">Event change emails</span>
          <span className="block text-sm text-ink-soft">
            Email me when an event I reserved is cancelled or its time or
            location changes. Changes always show in your calendar.
          </span>
        </span>
      </label>
    </section>
  );
}
