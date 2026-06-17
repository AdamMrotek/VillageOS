"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNavItems } from "./nav-items";

export default function NavLinks() {
  const pathname = usePathname();
  const items = useNavItems();

  return (
    <nav className="hidden items-center gap-6 md:flex">
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
