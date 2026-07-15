"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AccountSettings from "@repo/ui/custom_components/account-settings";
import { deleteAccount } from "@/lib/api-client";
import { useIsDemo } from "@/lib/hooks/use-is-demo";

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
    />
  );
}
