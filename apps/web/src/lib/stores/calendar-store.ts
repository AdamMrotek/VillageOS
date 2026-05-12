import { create } from "zustand";
import { addDays, startOfWeek } from "@/lib/utils/date";

type CalendarStore = {
  weekAnchor: Date;
  setWeekAnchor: (date: Date) => void;
  shiftWeek: (deltaWeeks: number) => void;
  goToToday: () => void;

  openEventId: string | null;
  setOpenEventId: (id: string | null) => void;
};

export const useCalendarStore = create<CalendarStore>((set) => ({
  weekAnchor: startOfWeek(new Date()),
  setWeekAnchor: (date) => set({ weekAnchor: startOfWeek(date) }),
  shiftWeek: (delta) =>
    set((s) => ({ weekAnchor: addDays(s.weekAnchor, delta * 7) })),
  goToToday: () => set({ weekAnchor: startOfWeek(new Date()) }),

  openEventId: null,
  setOpenEventId: (id) => set({ openEventId: id }),
}));
