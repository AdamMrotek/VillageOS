"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import Logo from "@repo/ui/custom_components/logo";
import Navbar from "@repo/ui/custom_components/navbar";

const LINKS = [
  { href: "/", label: "Experiments" },
  { href: "/evals", label: "Evals" },
];

/** Top nav shared across the admin dashboards. Hidden on /login (which has no
 *  session yet). Each page keeps its own auth gate, so the nav is purely
 *  navigation — it doesn't fetch. Uses the shared brand + container so it matches
 *  the main web app, with an "Admin" tag to distinguish the surface. */
export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <Navbar
      containerClassName="max-w-3xl"
      left={
        <>
          <div className="flex items-center gap-2">
            <Logo href="/" />
            <span className="bg-foreground px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wide text-background">
              Admin
            </span>
          </div>
          <nav className="flex items-center gap-6">
            {LINKS.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`py-3 text-[13px] font-medium leading-[1.45] transition-colors ${
                    active
                      ? "border-b-2 border-accent text-ink"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </>
      }
    />
  );
}
