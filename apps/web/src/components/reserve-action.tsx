"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@repo/ui/components/button";
import { spotsLeft } from "@/components/provider-event-card";
import { useIsDemo } from "@/lib/hooks/use-is-demo";
import {
  useCancelReservation,
  useReserveSpot,
} from "@/lib/queries/provider-events";
import {
  MAX_SPOTS_PER_RESERVATION,
  type ListedProviderEvent,
} from "@/lib/types/provider-events";

const linkClass = "text-primary underline underline-offset-4";

/** The parent's controls on a provider's event: reserve, or — once reserved —
 *  see it in the calendar and cancel. Capacity is decided by the server; the
 *  count here only decides what to offer, so a stale "2 spots left" at worst
 *  gets a "Not enough spots left" answer. */
export default function ReserveAction({ event }: { event: ListedProviderEvent }) {
  const { data: isDemo } = useIsDemo();
  const reserve = useReserveSpot();
  const cancel = useCancelReservation();
  const [spots, setSpots] = useState(1);
  const busy = reserve.isPending || cancel.isPending;

  if (event.status !== "published") return null;

  if (event.my_spots > 0) {
    return (
      <>
        <span className="self-center text-sm text-ink">
          You have {event.my_spots} {event.my_spots === 1 ? "spot" : "spots"}{" "}
          reserved ·{" "}
          <Link href="/calendar" className={linkClass}>
            View in calendar
          </Link>
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            cancel.mutate(event.id, {
              onSuccess: () => toast.success("Reservation cancelled."),
            })
          }
        >
          Cancel reservation
        </Button>
      </>
    );
  }

  // The start has passed (the listing keeps events for a day after they begin).
  if (!event.is_all_day && new Date(event.start_time) < new Date()) return null;

  const left = spotsLeft(event);
  if (left === 0) {
    return (
      <Button size="sm" disabled>
        Full
      </Button>
    );
  }

  // Demo sessions are anonymous: there is no account to hold a reservation.
  if (isDemo) {
    return (
      <span className="text-sm text-ink-soft">
        <Link href="/sign-up" className={linkClass}>
          Create an account
        </Link>{" "}
        to reserve a spot.
      </span>
    );
  }

  const maxSpots = Math.min(MAX_SPOTS_PER_RESERVATION, left ?? Infinity);
  // The list can refetch with fewer spots left than were selected.
  const chosen = Math.min(spots, maxSpots);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Spots
          <select
            value={chosen}
            onChange={(e) => setSpots(Number(e.target.value))}
            disabled={busy}
            className="h-8 rounded-md border border-hairline bg-surface px-2 text-sm text-ink"
          >
            {Array.from({ length: maxSpots }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            reserve.mutate(
              { eventId: event.id, spots: chosen },
              {
                onSuccess: () =>
                  toast.success("Reserved — it's now in your calendar."),
              },
            )
          }
        >
          {reserve.isPending ? "Reserving…" : "Reserve"}
        </Button>
      </div>
      <p className="text-xs text-ink-mute">
        The organiser sees how many spots are reserved, not who reserved them.
        We&apos;ll email you if the time or place changes.
      </p>
    </div>
  );
}
