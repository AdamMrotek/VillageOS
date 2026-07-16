import { test, expect } from "@playwright/test";

/** The extraction funnel, end to end: empty week → paste text → fake-provider
 *  draft renders → create → the event and its action items are visible on the
 *  calendar. Runs as the storageState user (no login form here).
 *
 *  Determinism: the browser clock is fixed inside the week the fixture's
 *  absolute dates land in (the server clock keeps running — that's why the
 *  fixture uses absolute dates). Keep FROZEN_NOW in sync with
 *  apps/api/app/services/extraction_fixtures/bake_sale.json, and keep this
 *  week clear of any future seeded events (rls.spec.ts seed data etc.). */
const FROZEN_NOW = new Date("2026-09-14T08:00:00Z"); // Monday of the fixture week

// "bake sale" is the fixture's trigger phrase.
const SOURCE_TEXT =
  "Hi all! Just a reminder the Summer Bake Sale is this Friday 18th at 3pm " +
  "in the school hall. Please bring £2 in a labelled envelope. Cake " +
  "donations very welcome — drop them at the office on Thursday. Sarah x";

// What the bake_sale.json fixture promises back.
const DRAFT = {
  title: "Summer Bake Sale",
  location: "School hall, Oakwood Primary",
  startTime: "15:00",
  actionItems: [
    "Bring £2 in a labelled envelope",
    "Drop cake donations at the school office",
  ],
};

// Fixture timestamps are zoneless; pinning the browser to UTC keeps the day
// they land on (and the rendered clock times) machine-independent.
test.use({ timezoneId: "UTC" });

/** The test creates an event, so the empty-week assert would fail on any run
 *  over a non-reset DB — a local re-run without `supabase db reset`, or a CI
 *  retry after a mid-test failure. Sweep leftover fixture events (matched by
 *  title, so a future seeded event for rls.spec.ts is never touched) through
 *  the real API, authing directly against local GoTrue. */
test.beforeEach(async ({ request }) => {
  const auth = await request.post(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      data: {
        email: process.env.E2E_USER_A_EMAIL,
        password: process.env.E2E_USER_A_PASSWORD,
      },
    },
  );
  expect(auth).toBeOK();
  const { access_token } = await auth.json();
  const headers = { Authorization: `Bearer ${access_token}` };

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const eventsResponse = await request.get(`${apiUrl}/api/events`, { headers });
  expect(eventsResponse).toBeOK();
  const events = await eventsResponse.json();
  for (const event of events) {
    if (event.title === DRAFT.title) {
      const deletion = await request.delete(`${apiUrl}/api/events/${event.id}`, { headers });
      expect(deletion).toBeOK();
    }
  }
});

test("extraction happy path: paste → extract → create → event on calendar", async ({
  page,
}) => {
  await page.clock.setFixedTime(FROZEN_NOW);

  // 1. The frozen week renders and is empty for this user. Wait out the
  //    loading overlays first — the empty state also shows while the events
  //    query is still in flight, and asserting during it would prove nothing.
  await page.goto("/calendar");
  await expect(
    page.getByRole("heading", { name: "Week of 14 September" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByText("Your week awaits")).toBeVisible();

  // 2. Capture → extraction (FastAPI + fake provider behind the real route).
  await page.getByRole("link", { name: "New event" }).click();
  await expect(page).toHaveURL(/\/calendar\/new/);
  await page.getByPlaceholder(/paste text/i).fill(SOURCE_TEXT);
  await page.getByRole("button", { name: /extract event/i }).click();

  // 3. The canned draft populates the review form.
  await expect(page.getByLabel("Title")).toHaveValue(DRAFT.title);
  await expect(page.getByLabel("Start time")).toHaveValue(DRAFT.startTime);
  await expect(page.getByLabel(/location/i)).toHaveValue(DRAFT.location);
  const itemInputs = page.getByLabel("Action item description");
  await expect(itemInputs).toHaveCount(DRAFT.actionItems.length);
  for (const [i, item] of DRAFT.actionItems.entries()) {
    await expect(itemInputs.nth(i)).toHaveValue(item);
  }

  // 4. Create → back on the calendar.
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/calendar$/);

  // 5. The event chip sits in the frozen week's grid (its accessible name
  //    starts with the start time), and the prep list carries its action
  //    items. Filter to visible: the grid renders desktop + mobile variants.
  const chip = page
    .getByRole("button", { name: new RegExp(`^${DRAFT.startTime} ${DRAFT.title}`) })
    .filter({ visible: true });
  await expect(chip).toBeVisible();

  const prepList = page
    .locator("section")
    .filter({ hasText: "Current Week Prep" });
  for (const item of DRAFT.actionItems) {
    await expect(prepList.getByText(item)).toBeVisible();
  }
  // The fixture's urgent item surfaces with its urgency, not just its text.
  await expect(prepList.getByText("URGENT")).toBeVisible();
});
