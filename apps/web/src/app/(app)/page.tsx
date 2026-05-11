import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-6 p-8">
      <h1 className="text-title">VillageOS</h1>
      <Link
        href="/events"
        className="inline-flex h-9 items-center justify-center rounded-sm bg-primary px-4 text-body text-primary-foreground hover:bg-primary/90"
      >
        View events
      </Link>
    </main>
  );
}
