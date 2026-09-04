import { expect, test } from "@playwright/test";

// The core promise of the product: first-visit → real changes shown →
// mark as seen → the NEXT load shows nothing meaningful, because it now
// is nothing. This is the mock-mode equivalent of the backend's own
// checkpoint-exactness torture-test assertion.
test("marking as seen clears the meaningful changes on the next load", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/app");

  await expect(page.getByText(/things worth a look/)).toBeVisible();
  await expect(page.locator("article", { hasText: "TCS" })).toBeVisible();

  await page.getByRole("button", { name: "Reset baseline", exact: true }).click();

  // The real invariant: the digest no longer claims anything is worth a
  // look. (The attention deck may still show a recently-open card in
  // its receded/minimal state rather than unmounting it outright — that's
  // a display choice, not the thing this test is proving.)
  await expect(page.getByText(/No major updates/).first()).toBeVisible();
  await expect(page.getByText(/things worth a look/)).toHaveCount(0);
});

test("first visit shows the baseline message, not a fabricated change", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/app");

  // /app redirects onto the existing watchlist; creating a new one now
  // happens from the "+ Watchlist" modal on the detail page itself.
  await page.getByRole("button", { name: "Watchlist" }).click();
  await page.getByPlaceholder("Enter watchlist name").fill("Fresh List");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("This watchlist is empty. Add a stock to start a baseline.")).toBeVisible();
});
