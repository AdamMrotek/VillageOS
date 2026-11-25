import { test, expect, type APIRequestContext } from "@playwright/test";

/** Provider events, end to end (docs/PROVIDER_EVENTS_PLAN.md phases 2 and 3a):
 *  a parent reserves a spot on a provider's event, it appears on their
 *  calendar, the provider moves it and the parent is shown what changed, then
 *  the provider cancels it.
 *
 *  The parent drives the real UI as the storageState user. The provider's side
 *  goes through the API — their pages are covered by the same endpoints, and
 *  it keeps one browser session in the test.
 *
 *  Each run publishes its own uniquely titled event, so a re-run over a
 *  non-reset database (or a CI retry) never collides with an earlier one. */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const PROVIDER_ID = process.env.E2E_PROVIDER_ID!;

async function providerHeaders(request: APIRequestContext) {
  const auth = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      data: {
        email: process.env.E2E_PROVIDER_EMAIL,
        password: process.env.E2E_PROVIDER_PASSWORD,
      },
    },
  );
  expect(auth).toBeOK();
  const { access_token } = await auth.json();
  return { Authorization: `Bearer ${access_token}` };
}

test("reserve a provider event, see it change, see it cancelled", async ({
  page,
  request,
}) => {
  const headers = await providerHeaders(request);
  const title = `E2E Training ${Date.now()}`;

  // Tomorrow, so it is bookable and always inside the calendar's visible days
  // (the week grid shows the current week plus a day either side).
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const draft = {
    title,
    event_type: "sport",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    is_all_day: false,
    location: "Pitch 1",
    description: null,
    capacity: 1,
  };

  const created = await request.post(`${API_URL}/api/providers/me/events`, {
    headers,
    data: draft,
  });
  expect(created).toBeOK();
  const { id: eventId } = await created.json();
  expect(
    await request.post(`${API_URL}/api/providers/me/events/${eventId}/publish`, {
      headers,
    }),
  ).toBeOK();

  // 1. The parent finds the event on the provider's page and reserves.
  await page.goto(`/discover/${PROVIDER_ID}`);
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(card.getByText("1 spot left")).toBeVisible();
  await card.getByRole("button", { name: "Reserve" }).click();
  await expect(card.getByText("You have 1 spot reserved")).toBeVisible();
  // The only spot is taken.
  await expect(card.getByText("Full", { exact: true })).toBeVisible();
  // 2. It is on their calendar. Filter to visible: the grid renders desktop
  //    and mobile variants.
  await page.goto("/calendar");
  const chip = page
    .getByRole("button", { name: new RegExp(title) })
    .filter({ visible: true });
  await expect(chip).toBeVisible();
  await expect(chip).not.toContainText("Updated");

  // 3. The provider moves it to a different pitch, an hour later.
  const moved = await request.put(
    `${API_URL}/api/providers/me/events/${eventId}`,
    {
      headers,
      data: {
        ...draft,
        start_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
        end_time: new Date(end.getTime() + 60 * 60 * 1000).toISOString(),
        location: "Pitch 2",
        notify_attendees: true,
      },
    },
  );
  expect(moved).toBeOK();
  expect((await moved.json()).version).toBe(2);

  // 4. The parent sees the badge, and on opening it, what changed.
  await page.reload();
  await expect(chip).toContainText("Updated");
  await chip.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Updated by the organiser")).toBeVisible();
  await expect(sheet.getByText(/^Time changed — it was/)).toBeVisible();
  await expect(
    sheet.getByText("Location changed — it was Pitch 1."),
  ).toBeVisible();
  await expect(sheet.getByText("E2E Sports Club")).toBeVisible();

  // 5. Opening it acknowledged the change: the badge is gone, and stays gone.
  // (The sheet also has an icon-only close button in its corner.)
  await sheet.getByRole("button", { name: "Close" }).first().click();
  await expect(chip).not.toContainText("Updated");
  await page.reload();
  await expect(chip).toBeVisible();
  await expect(chip).not.toContainText("Updated");

  // 6. The provider cancels. The event stays on the calendar, marked.
  expect(
    await request.post(`${API_URL}/api/providers/me/events/${eventId}/cancel`, {
      headers,
    }),
  ).toBeOK();
  await page.reload();
  await expect(chip).toContainText("Cancelled");
  await chip.click();
  await expect(
    sheet.getByText("The organiser cancelled this event."),
  ).toBeVisible();

  // 7. The parent clears it off their calendar.
  await sheet.getByRole("button", { name: "Remove from calendar" }).click();
  await sheet.getByRole("button", { name: "Confirm remove" }).click();
  await expect(chip).toHaveCount(0);
});
