import Link from "next/link";
import type { ReactNode } from "react";

type PageLayoutProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  children: ReactNode;
};

export default function PageLayout({
  title,
  backHref,
  backLabel = "Back",
  action,
  children,
}: PageLayoutProps) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-8 py-10">
      <header className="space-y-2">
        <p className="text-eyebrow min-h-[1.25rem]">
          {backHref ? (
            <Link
              href={backHref}
              className="underline-offset-4 hover:text-ink hover:underline"
            >
              ← {backLabel}
            </Link>
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </p>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-title text-ink">{title}</h1>
          {action}
        </div>
      </header>
      <div className="line-structural" />
      {children}
    </main>
  );
}
