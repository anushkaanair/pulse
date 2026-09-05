import { expect, test } from "@playwright/test";

// Regression guard for the cross-list corruption bug: every watchlist must
// own its item state. Adding/removing a stock on one list must NOT touch
// another's. The mock previously funnelled all mutations through a single
// shared `current` object, so editing "Long term" silently rewrote "Market
// watch" (and returned its 6 items under the wrong id). Runs against the
// mock layer, which seeds "Market watch" (6 symbols) + an empty "Long term".
test("editing one watchlist never touches another's stocks", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/app");
  await expect(page.getByText("Market watch").first()).toBeVisible();

  // Market watch starts with its 6 seeded symbols — the summary count is
  // the stable, unambiguous place to read the item total.
  await expect(page.getByText("Watchlist summary").locator("..").getByText("6").first()).toBeVisible();

  // Switch to the empty "Long term" list and add a single stock to it.
  await page.getByRole("link", { name: "Long term" }).first().click();
  await expect(page.getByText("This watchlist is empty. Add a stock to start a baseline.")).toBeVisible();
  const addBox = page.getByPlaceholder("Add a stock").first();
  await addBox.click();
  await addBox.fill("ZOMATO");
  const option = page.getByRole("button", { name: /ZOMATO/ }).first();
  await expect(option).toBeVisible();
  await option.click();

  // Long term now holds exactly one stock — not Market watch's six. (If the
  // old shared-state bug were back, this summary would read 6, not 1.)
  await expect(page.getByText("This watchlist is empty. Add a stock to start a baseline.")).toHaveCount(0);
  await expect(page.getByText("Watchlist summary").locator("..").getByText("1").first()).toBeVisible();

  // Back on Market watch: still exactly its 6 stocks — Zomato didn't leak in
  // as a 7th, and nothing was reset.
  await page.getByRole("link", { name: "Market watch" }).first().click();
  await expect(page.getByText("Watchlist summary").locator("..").getByText("6").first()).toBeVisible();

  // Removing the stock from Long term must not delete anything from Market
  // watch either — clear Long term, confirm Market watch still reads 6.
  await page.getByRole("link", { name: "Long term" }).first().click();
  await expect(page.getByText("Watchlist summary").locator("..").getByText("1").first()).toBeVisible();
  await page.getByRole("link", { name: "Market watch" }).first().click();
  await expect(page.getByText("Watchlist summary").locator("..").getByText("6").first()).toBeVisible();
});
