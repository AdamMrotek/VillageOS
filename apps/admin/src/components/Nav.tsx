"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Experiments" },
  { href: "/evals", label: "Evals" },
];

/** Top nav shared across the admin dashboards. Hidden on /login (which has no
 *  session yet). Each page keeps its own auth gate, so the nav is purely
 *  navigation — it doesn't fetch. */
export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-3xl items-center gap-1 px-5 py-2">
        <span className="mr-3 text-sm font-semibold tracking-tight">
          VillageOS Admin
        </span>
        {LINKS.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
