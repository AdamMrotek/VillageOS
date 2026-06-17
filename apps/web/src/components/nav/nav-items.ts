import { useRole } from "@/lib/hooks/use-role";

export type NavItem = { href: string; label: string };

const PARENT_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Calendar" },
  { href: "/discover", label: "Discover" },
];

const PROVIDER_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Calendar" },
  { href: "/provider", label: "My provider page" },
];

export function useNavItems(): NavItem[] {
  const { data: role } = useRole();
  return role === "provider" ? PROVIDER_ITEMS : PARENT_ITEMS;
}
