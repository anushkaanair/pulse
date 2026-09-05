import { expect, test } from "@playwright/test";

// The empty-first-visit problem: a brand-new watchlist has nothing to show
// a baseline against, which reads as broken rather than "just created."
// Starter packs are a one-click fix — reusing the existing bulk-replace
// mutation, not a new endpoint — so a fresh list can be populated instantly.
test("a starter pack fills an empty watchlist in one click", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/app");

  await page.getByRole("button", { name: "Watchlist" }).click();
  await page.getByPlaceholder("Enter watchlist name").fill("Fresh List");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("This watchlist is empty. Add a stock to start a baseline.")).toBeVisible();

  await page.getByRole("button", { name: "Banking" }).click();

  // Empty-state copy is gone, and the list now shows the Banking pack's
  // symbols (from mock.ts's known set, so they resolve to real quotes).
  await expect(page.getByText("This watchlist is empty. Add a stock to start a baseline.")).toHaveCount(0);
  await expect(page.getByText("Watchlist summary").locator("..").getByText("6").first()).toBeVisible();
  await expect(page.getByRole("list").getByText("HDFCBANK")).toBeVisible();
});
