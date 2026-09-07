import { expect, test } from "@playwright/test";

// Personalization (see backend changes/personalization.ts + the mock's
// mirror of it): a snooze is a real suppression, not a UI-only hide — the
// card drops out of the ranked deck because its kind was forced to "none"
// server-side, the same signal an actually-uninteresting stock produces.
test("snoozing a card removes it from the ranked attention deck", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pulse-entered", "1"));
  await page.goto("/app");

  // TCS is the front card of 3 ("3 worth a look") in the seeded mock demo.
  await expect(page.getByText("3 worth a look", { exact: false })).toBeVisible();
  const tcsCard = page.locator("article", { hasText: "TCS" });
  await expect(tcsCard).toBeVisible();

  // Open it — this is what fires the "you opened this" personalization
  // signal on the real backend; here it just needs to reveal the Snooze
  // button, which only renders on the expanded front card.
  await tcsCard.click();
  const snoozeButton = tcsCard.getByRole("button", { name: "Snooze for 24h" });
  await expect(snoozeButton).toBeVisible();
  await snoozeButton.click();

  // The deck re-fetches after snoozing — TCS drops out, so the deck goes
  // from 3 to 2, and TCS itself is no longer one of the ranked cards.
  await expect(page.getByText("2 worth a look", { exact: false })).toBeVisible();
  await expect(page.locator("article", { hasText: "TCS" })).toHaveCount(0);
});
