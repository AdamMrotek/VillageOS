import Link from "next/link";

import { cn } from "@repo/ui/lib/utils";

export interface LogoProps {
  /** Where the logo links to. Apps point this at their own home route. */
  href?: string;
  /** Wordmark shown next to the badge. */
  label?: string;
  className?: string;
}

/** The VillageOS brand mark — a "V" badge plus wordmark. Built on semantic
 *  tokens (`foreground`/`background`) so it renders identically in any app that
 *  defines them (web + admin both do). */
export default function Logo({
  href = "/",
  label = "VillageOS",
  className,
}: LogoProps) {
  return (
    <Link href={href} className={cn("flex items-center gap-2", className)}>
      <span className="grid h-7 w-7 place-items-center rounded-sm bg-foreground font-display text-base leading-none text-background">
        V
      </span>
      <span className="font-display text-lg tracking-tight text-foreground">
        {label}
      </span>
    </Link>
  );
}
