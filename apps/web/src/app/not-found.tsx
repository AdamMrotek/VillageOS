import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-16 text-center">
      <div className="space-y-5">
        <p className="text-eyebrow-accent">Error 404</p>
        <h1 className="text-hero text-ink">
          This page slipped through the cracks.
        </h1>
        <p className="text-ink-soft mx-auto max-w-md text-base leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
          Let&apos;s get you back on track.
        </p>
      </div>

      <Link
        href="/"
        className="inline-flex h-11 items-center justify-center rounded-sm bg-primary px-6 text-body text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Back to home
      </Link>
    </main>
  );
}
