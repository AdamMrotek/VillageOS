import { test, expect } from "@playwright/test";

/** The Discover browse page (docs/PROVIDER_EVENTS_PLAN.md §4, phase D1): a
 *  parent lands on rows that mix events, venues and entertainers, filters by
 *  kind, follows an event card to where they can reserve, and searches.
 *
 *  The venue and entertainer are seeded (supabase/seed.sql). The event is
 *  published through the API as the seeded provider, uniquely titled so a
 *  re-run over a non-reset database never matches an earlier one. */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const PROVIDER_ID = process.env.E2E_PROVIDER_ID!;

test("browse rows, filter by kind, open an event, search", async ({
  page,
  request,
}) => {
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
  const headers = {
    Authorization: `Bearer ${(await auth.json()).access_token}`,
  };

  // In two hours: inside "This week", and sooner than anything the other
  // specs publish, so it is within the row's first cards.
  const title = `E2E Discover ${Date.now()}`;
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const created = await request.post(`${API_URL}/api/providers/me/events`, {
    headers,
    data: {
      title,
      event_type: "sport",
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      is_all_day: false,
      location: "Pitch 1",
      description: null,
      capacity: 5,
    },
  });
  expect(created).toBeOK();
  const { id: eventId } = await created.json();
  expect(
    await request.post(
      `${API_URL}/api/providers/me/events/${eventId}/publish`,
      { headers },
    ),
  ).toBeOK();

  try {
    // 1. The "done when": at least three filled rows, mixing events, venues
    //    and entertainers. Regions are scoped to <main>: the toast area is a
    //    region too.
    await page.goto("/discover");
    const main = page.getByRole("main");
    const thisWeek = main.getByRole("region", { name: "This week" });
    const event = thisWeek.getByRole("link", { name: new RegExp(title) });
    await expect(event).toBeVisible();
    await expect(event.getByText("5 spots left")).toBeVisible();
    const venues = main.getByRole("region", {
      name: /^(Popular venues|Venues)$/,
    });
    await expect(venues.getByText("E2E Leisure Centre")).toBeVisible();
    const entertainers = main.getByRole("region", { name: "Entertainers" });
    await expect(entertainers.getByText("E2E Magician")).toBeVisible();
    expect(await main.getByRole("region").count()).toBeGreaterThanOrEqual(3);

    // 2. The Venues chip leaves only venues.
    await page.getByRole("button", { name: "Venues", exact: true }).click();
    await expect(thisWeek).toHaveCount(0);
    await expect(entertainers).toHaveCount(0);
    await expect(venues.getByText("E2E Leisure Centre")).toBeVisible();
    await expect(main.getByText("E2E Magician")).toHaveCount(0);

    // 3. Back to everything; an event card leads to the provider's page,
    //    scrolled to that event, where the parent can reserve.
    await page.getByRole("button", { name: "All", exact: true }).click();
    await event.click();
    await expect(page).toHaveURL(
      new RegExp(`/discover/${PROVIDER_ID}#event-${eventId}$`),
    );
    const card = page.locator(`#event-${eventId}`);
    await expect(card).toBeInViewport();
    await expect(card.getByRole("button", { name: "Reserve" })).toBeVisible();

    // 4. Typing a search switches to the results grid.
    await page.goto("/discover");
    await page
      .getByRole("searchbox", { name: "Search providers" })
      .fill("Magician");
    await expect(main.getByRole("link", { name: /E2E Magician/ })).toBeVisible();
    await expect(main.getByRole("region")).toHaveCount(0);
  } finally {
    // The event would otherwise sit in later runs' rows.
    await request.post(
      `${API_URL}/api/providers/me/events/${eventId}/cancel`,
      { headers },
    );
  }
});
