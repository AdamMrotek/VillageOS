import { useRole } from "@/lib/hooks/use-role";

export type NavItem = { href: string; label: string };

const PARENT_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Calendar" },
  { href: "/discover", label: "Discover" },
];

const PROVIDER_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Calendar" },
  { href: "/provider", label: "My provider page" },
  { href: "/provider/events", label: "My events" },
];

export function useNavItems(): NavItem[] {
  const { data: role } = useRole();
  return role === "provider" ? PROVIDER_ITEMS : PARENT_ITEMS;
}

/** The nav item for the current path: the longest href that matches, so
 *  `/provider/events` lights up "My events" and not also "My provider page". */
export function activeHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
