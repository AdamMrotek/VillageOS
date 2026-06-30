import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

export interface NavbarProps {
  /** Content for the left group — typically the `Logo` plus nav links. */
  left?: ReactNode;
  /** Content pinned to the right — e.g. a user menu. Omit for a left-aligned bar. */
  right?: ReactNode;
  /** Override the `<header>` element (border / background). */
  className?: string;
  /** Override the inner container (width / padding). Defaults to `max-w-6xl`. */
  containerClassName?: string;
  /** Override the left group's internal spacing. */
  leftClassName?: string;
}

/** Shared top-bar container: a bordered header with a centered, width-capped row
 *  that lays out a left group and an optional right group. Styling uses semantic
 *  tokens (`card`/`border`) so it themes correctly in every app. */
export default function Navbar({
  left,
  right,
  className,
  containerClassName,
  leftClassName,
}: NavbarProps) {
  return (
    <header className={cn("border-b border-border bg-card", className)}>
      <div
        className={cn(
          "mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10",
          containerClassName,
        )}
      >
        <div className={cn("flex items-center gap-4 md:gap-12", leftClassName)}>
          {left}
        </div>
        {right ? (
          <div className="flex items-center gap-6">{right}</div>
        ) : null}
      </div>
    </header>
  );
}
