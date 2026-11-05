import { describe, expect, it } from "vitest";
import {
  buildGoogleCalendarUrl,
  buildIcs,
  foldIcsLine,
  icsFilename,
} from "./calendar-export";

const base = {
  id: "evt-1",
  title: "Bake sale",
  start_time: "2026-11-10T14:00:00Z",
  end_time: "2026-11-10T15:30:00Z",
  is_all_day: false,
  location: "School hall",
  description: "Bring cakes",
  action_items: [],
};

const NOW = new Date("2026-11-05T09:00:00Z");

function params(url: string) {
  return new URL(url).searchParams;
}

describe("buildGoogleCalendarUrl", () => {
  it("uses UTC start/end for timed events", () => {
    const p = params(buildGoogleCalendarUrl(base));
    expect(p.get("action")).toBe("TEMPLATE");
    expect(p.get("text")).toBe("Bake sale");
    expect(p.get("dates")).toBe("20261110T140000Z/20261110T153000Z");
    expect(p.get("location")).toBe("School hall");
  });

  it("defaults to a 1h duration when end_time is null", () => {
    const p = params(buildGoogleCalendarUrl({ ...base, end_time: null }));
    expect(p.get("dates")).toBe("20261110T140000Z/20261110T150000Z");
  });

  it("uses date-only values with exclusive end for all-day events", () => {
    const start = new Date(2026, 10, 10); // local midnight
    const p = params(
      buildGoogleCalendarUrl({
        ...base,
        is_all_day: true,
        start_time: start.toISOString(),
        end_time: null,
      }),
    );
    expect(p.get("dates")).toBe("20261110/20261111");
  });

  it("omits location when null and encodes special characters", () => {
    const url = buildGoogleCalendarUrl({
      ...base,
      location: null,
      title: "Q&A: cakes, pies",
    });
    expect(params(url).has("location")).toBe(false);
    expect(params(url).get("text")).toBe("Q&A: cakes, pies");
  });

  it("appends action items and attribution to details", () => {
    const p = params(
      buildGoogleCalendarUrl({
        ...base,
        action_items: [
          { id: "a", description: "Buy flour", done: false, cost_estimate_gbp: null, urgent: false },
          { id: "b", description: "Book hall", done: true, cost_estimate_gbp: null, urgent: false },
        ],
      }),
    );
    const details = p.get("details")!;
    expect(details).toContain("Bring cakes");
    expect(details).toContain("[ ] Buy flour");
    expect(details).toContain("[x] Book hall");
    expect(details).toContain("Added from VillageOS");
  });
});

describe("buildIcs", () => {
  it("produces a CRLF VEVENT with stable UID and UTC times", () => {
    const ics = buildIcs(base, NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:evt-1@villageos");
    expect(ics).toContain("DTSTAMP:20261105T090000Z");
    expect(ics).toContain("DTSTART:20261110T140000Z");
    expect(ics).toContain("DTEND:20261110T153000Z");
    expect(ics).toContain("LOCATION:School hall");
  });

  it("uses VALUE=DATE for all-day events", () => {
    const ics = buildIcs(
      {
        ...base,
        is_all_day: true,
        start_time: new Date(2026, 10, 10).toISOString(),
        end_time: null,
      },
      NOW,
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20261110");
    expect(ics).toContain("DTEND;VALUE=DATE:20261111");
  });

  it("escapes commas, semicolons, backslashes and newlines", () => {
    const ics = buildIcs({ ...base, title: "A, B; C\\D" }, NOW);
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\\\D");
    // description has real newlines (attribution separator) → literal \n
    expect(ics).toMatch(/DESCRIPTION:Bring cakes\\n\\nAdded from VillageOS/);
  });

  it("omits LOCATION when null", () => {
    expect(buildIcs({ ...base, location: null }, NOW)).not.toContain("LOCATION");
  });
});

describe("foldIcsLine", () => {
  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds long lines so no physical line exceeds 75 octets", () => {
    const folded = foldIcsLine("DESCRIPTION:" + "x".repeat(200));
    const enc = new TextEncoder();
    for (const l of folded.split("\r\n")) {
      expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "x".repeat(200));
  });

  it("never splits multibyte characters", () => {
    const line = "SUMMARY:" + "é".repeat(100);
    const folded = foldIcsLine(line);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("icsFilename", () => {
  it("slugifies the title", () => {
    expect(icsFilename("Bake Sale! (Year 3)")).toBe("bake-sale-year-3.ics");
  });
  it("falls back to 'event'", () => {
    expect(icsFilename("***")).toBe("event.ics");
  });
});
