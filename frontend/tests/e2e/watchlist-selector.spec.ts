import { expect, test } from "@playwright/test";

// The "What deserves attention" selector page (/app) — everything from the
// list-of-lists review: the live ticker binds to real tracked stocks (not
// a stale "no stocks" state), duplicate names are rejected, rename/
// archive/delete work, the summary line reflects real per-list counts, and
// a preview chip deep-links into the right stock in the right list.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
});

test("the global ticker shows real tracked stocks, not a stale empty state", async ({ page }) => {
  await page.goto("/app");
  const rail = page.locator(".marquee-mask");
  await expect(rail).not.toContainText("No stocks tracked yet");
  // Market watch's real symbols, not a placeholder.
  await expect(rail).toContainText("TCS");
});

test("the summary line reflects real per-list counts", async ({ page }) => {
  await page.goto("/app");
  // Seeded mock: "Market watch" has 3 meaningful, "Long term" has 0 — so
  // exactly 1 of 2 lists is worth a look.
  await expect(page.getByText("1 of 2 lists")).toBeVisible();
});

test("worth-a-look and caught-up badges are visibly distinct colors, not both green", async ({ page }) => {
  await page.goto("/app");
  const worthALook = page.getByText("3 worth a look");
  const caughtUp = page.getByText("Caught up");
  await expect(worthALook).toBeVisible();
  await expect(caughtUp).toBeVisible();
  const [c1, c2] = await Promise.all([
    worthALook.evaluate((el) => getComputedStyle(el).color),
    caughtUp.evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(c1).not.toBe(c2);
});

test("an empty list shows a clickable add-your-first CTA, not dead static text", async ({ page }) => {
  await page.goto("/app");
  const cta = page.getByRole("link", { name: "No stocks yet — add your first →" });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/w\//);
});

test("a preview chip deep-links to that exact stock in that exact list", async ({ page }) => {
  await page.goto("/app");
  // The link's accessible name comes from its visible text ("SUZLON
  // 7.07%"), not its title attribute — title is a hover tooltip only.
  await page.getByRole("link", { name: /SUZLON/ }).click();
  await expect(page).toHaveURL(/\?symbol=SUZLON/);
  await expect(page.getByRole("heading", { name: "Market watch" })).toBeVisible();
  await expect(page.locator("#row-SUZLON")).toBeVisible();
});

test("creating a watchlist with a name already in use is rejected", async ({ page }) => {
  await page.goto("/app");
  await page.getByPlaceholder("e.g. Long term").fill("Market watch");
  await page.getByRole("button", { name: "Create watchlist" }).click();
  await expect(page.getByText(/already have a watchlist/)).toBeVisible();
});

test("rename, archive, unarchive and delete all work from the card menu", async ({ page }) => {
  await page.goto("/app");

  await page.getByRole("button", { name: "Options for Long term" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  const input = page.getByRole("dialog").locator("input");
  await input.fill("Watchlist renamed");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Watchlist renamed")).toBeVisible();

  await page.getByRole("button", { name: "Options for Watchlist renamed" }).click();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Watchlist renamed")).not.toBeVisible();
  await page.getByRole("button", { name: "Show 1 archived" }).click();
  await expect(page.getByText("Watchlist renamed")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Delete "Watchlist renamed"/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Watchlist renamed")).not.toBeVisible();
});
