"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, useNavItems } from "./nav-items";

export default function BottomNav() {
  const pathname = usePathname();
  const items = useNavItems();
  const current = activeHref(items, pathname);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-6xl items-stretch">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex h-full items-center justify-center px-2 py-3 text-body transition-colors ${
                  active ? "font-medium text-ink" : "text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
