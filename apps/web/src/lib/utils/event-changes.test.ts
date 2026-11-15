import { describe, expect, it } from "vitest";
import type { EventSnapshot } from "@/lib/types/events";
import { describeChanges, formatEventWhen } from "./event-changes";

function snapshot(overrides: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    // No offset: read as local time, so the expectations hold in any timezone.
    start_time: "2026-11-20T16:00:00",
    end_time: "2026-11-20T17:00:00",
    is_all_day: false,
    location: "Riverside Pitch 2",
    status: "published",
    ...overrides,
  };
}

describe("formatEventWhen", () => {
  it("shows the day and the time range", () => {
    expect(formatEventWhen(snapshot())).toBe("Fri, 20 Nov 2026 · 16:00 – 17:00");
  });

  it("shows only the start when there is no end", () => {
    expect(formatEventWhen(snapshot({ end_time: null }))).toBe(
      "Fri, 20 Nov 2026 · 16:00",
    );
  });

  it("drops the time for an all-day event", () => {
    expect(formatEventWhen(snapshot({ is_all_day: true }))).toBe(
      "Fri, 20 Nov 2026 · All day",
    );
  });
});

describe("describeChanges", () => {
  it("is empty when nothing a parent plans around changed", () => {
    expect(describeChanges(snapshot(), snapshot())).toEqual([]);
  });

  it("says what the time was", () => {
    const now = snapshot({
      start_time: "2026-11-20T17:00:00",
      end_time: "2026-11-20T18:00:00",
    });
    expect(describeChanges(snapshot(), now)).toEqual([
      "Time changed — it was Fri, 20 Nov 2026 · 16:00 – 17:00.",
    ]);
  });

  it("says what the location was", () => {
    expect(
      describeChanges(snapshot(), snapshot({ location: "Sports Hall" })),
    ).toEqual(["Location changed — it was Riverside Pitch 2."]);
  });

  it("reports a location added where there was none", () => {
    expect(
      describeChanges(snapshot({ location: null }), snapshot()),
    ).toEqual(["A location was added."]);
  });

  it("reports time and location together", () => {
    const now = snapshot({ end_time: null, location: "Sports Hall" });
    expect(describeChanges(snapshot(), now)).toHaveLength(2);
  });

  it("reports a cancellation on its own, whatever else changed", () => {
    const now = snapshot({ status: "cancelled", location: "Sports Hall" });
    expect(describeChanges(snapshot(), now)).toEqual([
      "The organiser cancelled this event.",
    ]);
  });
});
