import { expect, test } from "@playwright/test";

// The mock seeds IDEA as already stale — this proves the badge renders
// without needing to fake an outage. Toggling the fault (via the same
// /api/_sim/faults shape the real backend uses) proves FeedStatusBar
// responds to a degraded feed honestly, never hiding it.
test("a stale symbol shows its badge without a feed-wide outage", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/app");
  await page.getByRole("link", { name: /Market watch/ }).click();

  const ideaRow = page.locator("li", { hasText: "IDEA" });
  await expect(ideaRow.getByText(/old$/)).toBeVisible();
});

test("toggling a feed outage shows the degraded banner, and it never blanks the page", async ({ page }) => {
  // The mock lives in the page's JS module state, not a server — so this
  // whole test stays on ONE page load and moves via client-side Links
  // only. A page.goto() mid-test would silently reset the mock's fault
  // state, since it's re-initialized fresh on every real navigation.
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/dev/faults");
  // A controlled checkbox whose state comes back from an async setFaults
  // call — .check() asserts a synchronous state flip and flakes, so click
  // it and assert the outcome (the banner) instead.
  await page.getByRole("checkbox").first().click();

  await page.getByRole("link", { name: "Back to watchlists" }).click();
  await page.getByRole("link", { name: /Market watch/ }).click();

  await expect(page.getByRole("status")).toContainText("Data may be delayed");
  // The list is still there — degraded feed never means a blank screen.
  await expect(page.getByRole("list").getByText("TCS")).toBeVisible();
});
