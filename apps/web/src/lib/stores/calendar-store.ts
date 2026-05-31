import { useEffect } from "react";
import { create } from "zustand";
import { addDays, isSameDay, startOfWeek } from "@/lib/utils/date";

type CalendarStore = {
  // `today` (start of day) and `weekAnchor` (Monday of the week in view) are the
  // single source of truth for the current/selected date across every calendar
  // surface. Both are `null` until the client populates them after mount via
  // init(), and must NEVER be computed eagerly: this module is evaluated during
  // SSR (in UTC), so eager `new Date()` values would bake a server-timezone date
  // into the initial HTML and cause an off-by-one hydration mismatch.
  today: Date | null;
  weekAnchor: Date | null;
  init: () => void;

  setWeekAnchor: (date: Date) => void;
  shiftWeek: (deltaWeeks: number) => void;
  goToToday: () => void;

  openEventId: string | null;
  setOpenEventId: (id: string | null) => void;
};

export const useCalendarStore = create<CalendarStore>((set) => ({
  today: null,
  weekAnchor: null,
  init: () =>
    set((s) => {
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      const patch: Partial<CalendarStore> = {};
      // Keep the existing reference stable when the day is unchanged so
      // consumers don't re-render needlessly on repeated mounts.
      if (!s.today || !isSameDay(s.today, today)) patch.today = today;
      // Seed the week only once — user navigation must not be overwritten.
      if (!s.weekAnchor) patch.weekAnchor = startOfWeek(now);
      return patch;
    }),

  setWeekAnchor: (date) => set({ weekAnchor: startOfWeek(date) }),
  shiftWeek: (delta) =>
    set((s) =>
      s.weekAnchor ? { weekAnchor: addDays(s.weekAnchor, delta * 7) } : s,
    ),
  goToToday: () => set({ weekAnchor: startOfWeek(new Date()) }),

  openEventId: null,
  setOpenEventId: (id) => set({ openEventId: id }),
}));

/**
 * Reads today (start of day) from the store, initializing the calendar on the
 * client after mount. Returns `null` until mounted — guard date-dependent UI on
 * a non-null value to stay hydration-safe.
 */
export function useToday(): Date | null {
  const today = useCalendarStore((s) => s.today);
  const init = useCalendarStore((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);
  return today;
}

/**
 * Reads the week anchor (Monday of the week in view) from the store,
 * initializing the calendar on the client after mount. Returns `null` until
 * mounted — render a skeleton until it resolves to stay hydration-safe.
 */
export function useWeekAnchor(): Date | null {
  const weekAnchor = useCalendarStore((s) => s.weekAnchor);
  const init = useCalendarStore((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);
  return weekAnchor;
}
