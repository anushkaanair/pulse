import { expect, test } from "@playwright/test";

// Regression test for the exact bug found in review and fixed in commit
// 940e43f: the conflict modal's "Keep mine" used to retry with the stale
// pre-conflict version, so it 409'd forever and could never actually win.
test("a genuine version conflict shows the modal, and 'Keep mine' now actually succeeds", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Market watch/ }).click();

  await page.getByRole("button", { name: "Bulk edit symbols" }).click();
  await expect(page.getByLabel("Symbols, comma separated")).toBeVisible();

  // Simulate a concurrent successful edit from "another device" — bumps
  // the mock's server-side version out from under this page's local state,
  // the same way a real second browser tab would via the real backend.
  await page.evaluate(async () => {
    const mock = (window as unknown as { __mock: { __simulateConcurrentEdit: (s: string[]) => Promise<void> } }).__mock;
    await mock.__simulateConcurrentEdit(["TCS", "SUZLON"]);
  });

  // This page still thinks it's editing against the old version — saving
  // now must produce a genuine conflict, not a silent overwrite.
  await page.getByRole("button", { name: "Save list" }).click();

  await expect(page.getByText("Another edit arrived")).toBeVisible();
  await expect(page.getByText("Choose which list to keep")).toBeVisible();

  await page.getByRole("button", { name: "Keep mine" }).click();

  // The bug: this used to retry with the stale version and 409 again,
  // forever. The fix: it retries with the server's real version and wins.
  await expect(page.getByText("Another edit arrived")).toHaveCount(0, { timeout: 5000 });
});
