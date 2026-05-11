"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

const items: NavItem[] = [{ href: "/events", label: "Events" }];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-6">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`text-body py-3 transition-colors ${
              active
                ? "line-accent-nav text-ink"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
