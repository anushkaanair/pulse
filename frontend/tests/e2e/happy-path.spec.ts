import { expect, test } from "@playwright/test";

// Runs against the mock data layer (see playwright.config.ts) — the mock
// seeds one existing watchlist ("Market watch") with 6 symbols, 3 of them
// meaningful, so the happy path is reachable with zero setup. /app itself
// is just a redirector now (auto-lands on the first/only watchlist), so a
// visit lands directly on the watchlist detail page.
test("open a watchlist and see the ranked meaningful changes", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/app");
  await expect(page.getByText("Market watch").first()).toBeVisible();

  // The digest line — the loudest text on the page per DESIGN_SYSTEM.md.
  await expect(page.getByText(/things worth a look/)).toBeVisible();

  // TCS is the top-ranked (front) card — compact by default, showing only
  // identity/price/σ; the full reasoning is the reward for opening it.
  const tcsCard = page.locator("article", { hasText: "TCS" });
  await expect(tcsCard).toBeVisible();
  await tcsCard.click();
  await expect(tcsCard.getByText(/unusual for TCS/)).toBeVisible();

  // Full list shows all 6 symbols, including ones with kind:"none" — the
  // watchlist-summary card's own tracked count is the stable place to
  // check this now that the page header no longer repeats the count.
  await expect(page.getByText("Watchlist summary").locator("..").getByText("6")).toBeVisible();
  // Scoped to the tracked-stocks list: the symbol also appears in the live
  // market rail's ticker-tape (twice, for the seamless loop), so a bare
  // getByText would match multiple nodes.
  await expect(page.getByRole("list").getByText("HDFCBANK")).toBeVisible();
});
