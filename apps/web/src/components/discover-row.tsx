"use client";

import { useEffect, useRef, useState } from "react";
import { EventTile, ProviderTile } from "@/components/discover-cards";
import type { DiscoverRow } from "@/lib/types/discover";

function ScrollButton({
  direction,
  onClick,
}: {
  direction: "back" | "forward";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "back" ? "Scroll back" : "Scroll forward"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-input bg-surface text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={`h-4 w-4 ${direction === "back" ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 3l5 5-5 5" />
      </svg>
    </button>
  );
}

/** One titled row of cards that scrolls sideways. Touch and trackpads scroll
 *  it directly; the arrow buttons are for a mouse. */
export default function DiscoverRowSection({ row }: { row: DiscoverRow }) {
  const scroller = useRef<HTMLUListElement>(null);
  const headingId = `row-${row.id}`;

  // Arrows only when the cards don't all fit; re-checked as the window resizes.
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [row.items.length]);

  function scrollBy(direction: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id={headingId} className="text-heading text-ink">
          {row.title}
        </h2>
        {overflows && (
          <div className="hidden gap-2 md:flex">
            <ScrollButton direction="back" onClick={() => scrollBy(-1)} />
            <ScrollButton direction="forward" onClick={() => scrollBy(1)} />
          </div>
        )}
      </div>
      {/* Bleeds to the screen edge on phones so the next card peeks in. */}
      <ul
        ref={scroller}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:scroll-px-0 md:px-0"
      >
        {row.item_type === "event"
          ? row.items.map((event) => (
              <li key={event.id} className="w-60 shrink-0 snap-start">
                <EventTile event={event} />
              </li>
            ))
          : row.items.map((provider) => (
              <li key={provider.user_id} className="w-60 shrink-0 snap-start">
                <ProviderTile provider={provider} />
              </li>
            ))}
      </ul>
    </section>
  );
}
