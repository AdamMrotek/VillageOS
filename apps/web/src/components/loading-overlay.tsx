"use client";

import { cn } from "@repo/ui/lib/utils";
import { Spinner } from "@repo/ui/components/spinner";

/**
 * A v-loading-style overlay: drop it in as the last child of a `relative`
 * container and it covers the container with a translucent surface wash and a
 * centered spinner while `loading` is true. Renders nothing when not loading.
 *
 *   <section className="relative ...">
 *     {content}
 *     <LoadingOverlay loading={isFetching} label="Loading week…" />
 *   </section>
 *
 * `rounded-[inherit]` makes the wash follow the container's own corner radius.
 */
export function LoadingOverlay({
  loading,
  label = "Loading…",
  className,
}: {
  loading: boolean;
  label?: string;
  className?: string;
}) {
  if (!loading) return null;
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-surface/75 backdrop-blur-[1px]",
        className,
      )}
    >
      <Spinner className="size-7 text-accent-dark" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
