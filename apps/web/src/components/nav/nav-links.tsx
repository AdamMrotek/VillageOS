"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRole } from "@/lib/hooks/use-role";

type NavItem = { href: string; label: string };

const PARENT_ITEMS: NavItem[] = [
  { href: "/events", label: "Events" },
  { href: "/discover", label: "Discover" },
];

const PROVIDER_ITEMS: NavItem[] = [
  { href: "/events", label: "Events" },
  { href: "/provider", label: "My provider page" },
];

export default function NavLinks() {
  const pathname = usePathname();
  const { data: role } = useRole();
  const items = role === "provider" ? PROVIDER_ITEMS : PARENT_ITEMS;

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
