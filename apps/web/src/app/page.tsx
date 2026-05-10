import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/sign-out-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-24">
      <h1 className="text-4xl font-bold tracking-tight">VillageOS</h1>
      <p className="text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{user.email}</span>
      </p>
      <Link
        href="/events"
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
      >
        View events
      </Link>
      <SignOutButton />
    </main>
  );
}
