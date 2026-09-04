import { expect, test } from "@playwright/test";

// Runs against the mock data layer (see playwright.config.ts) — the mock
// seeds one existing watchlist ("Market watch") with 6 symbols, 3 of them
// meaningful, so the happy path is reachable with zero setup.
test("open a watchlist and see the ranked meaningful changes", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "What deserves attention" })).toBeVisible();

  await page.getByRole("link", { name: /Market watch/ }).click();
  await expect(page.getByRole("heading", { name: "Market watch" })).toBeVisible();

  // The digest line — the loudest text on the page per DESIGN_SYSTEM.md.
  await expect(page.getByText(/things worth a look/)).toBeVisible();

  // TCS is the top-ranked (front) card — compact by default, showing only
  // identity/price/σ; the full reasoning is the reward for opening it.
  const tcsCard = page.locator("article", { hasText: "TCS" });
  await expect(tcsCard).toBeVisible();
  await tcsCard.click();
  await expect(tcsCard.getByText(/unusual for TCS/)).toBeVisible();

  // Full list shows all 6 symbols, including ones with kind:"none".
  await expect(page.getByText("6 symbols")).toBeVisible();
  await expect(page.getByText("HDFCBANK")).toBeVisible();
});
