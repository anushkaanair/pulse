import { expect, test } from "@playwright/test";

// A direct or bookmarked hit on /app, without ever going through the
// homepage in this tab, must bounce back to "/" — "Get started" stays the
// one real front door. Deliberately does NOT pre-seed sessionStorage
// (unlike the other specs), so this is the one test that exercises the
// guard itself rather than working around it.
test("a direct /app link with no prior homepage visit redirects to the homepage", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Pulse" })).toBeVisible();

  // Now go through the real front door — Get started must still land on /app.
  await page.getByRole("button", { name: "Get started" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "What deserves attention" })).toBeVisible();
});

test("?as= impersonation link opens /app directly, bypassing the homepage", async ({ page }) => {
  await page.goto("/app?as=demo");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "What deserves attention" })).toBeVisible();
});
