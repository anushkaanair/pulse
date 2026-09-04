import { expect, test } from "@playwright/test";

// The core promise of the product: first-visit → real changes shown →
// mark as seen → the NEXT load shows nothing meaningful, because it now
// is nothing. This is the mock-mode equivalent of the backend's own
// checkpoint-exactness torture-test assertion.
test("marking as seen clears the meaningful changes on the next load", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("link", { name: /Market watch/ }).click();

  await expect(page.getByText(/things worth a look/)).toBeVisible();
  await expect(page.locator("article", { hasText: "TCS" })).toBeVisible();

  await page.getByRole("button", { name: "Mark as seen" }).click();

  await expect(page.getByText("Nothing meaningful changed since you last looked.")).toBeVisible();
  await expect(page.locator("article", { hasText: "TCS" })).toHaveCount(0);
});

test("first visit shows the baseline message, not a fabricated change", async ({ page }) => {
  await page.goto("/app");
  await page.getByPlaceholder("e.g. Long term").fill("Fresh List");
  await page.getByRole("button", { name: "Create watchlist" }).click();

  await expect(page.getByRole("link", { name: /Fresh List/ })).toBeVisible();
  await page.getByRole("link", { name: /Fresh List/ }).click();

  await expect(page.getByText("First look — this is your baseline.")).toBeVisible();
});
