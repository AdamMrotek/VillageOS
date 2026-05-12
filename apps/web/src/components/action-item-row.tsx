"use client";

import { cn } from "@repo/ui/lib/utils";
import type { ActionItem } from "@/lib/types/events";

export default function ActionItemRow({
  item,
  onToggle,
}: {
  item: ActionItem;
  onToggle: () => void;
}) {
  const showUrgent = item.urgent && !item.done;
  const showCost = item.cost_estimate_gbp != null;

  return (
    <li
      className={cn(
        "rounded-md border border-hairline bg-surface transition-colors",
        showUrgent && "border-l-2 border-l-warm",
        item.done && "opacity-60",
      )}
    >
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={item.done}
          onChange={onToggle}
          className="size-4 shrink-0 accent-accent"
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-body text-ink",
            item.done && "text-ink-mute line-through",
          )}
        >
          {item.description}
        </span>
        {showUrgent && (
          <span className="shrink-0 rounded-sm bg-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-surface">
            Urgent
          </span>
        )}
        {showCost && (
          <span className="shrink-0 font-mono text-meta tabular-nums text-ink-mute">
            £{item.cost_estimate_gbp!.toFixed(0)}
          </span>
        )}
      </label>
    </li>
  );
}
