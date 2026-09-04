import { defineConfig, devices } from "@playwright/test";

// Runs against the mock data layer by default (NEXT_PUBLIC_USE_MOCK=true,
// set in the webServer env below), so these pass with no backend or DB
// required — deliberately, so `npm run test:e2e` works on a fresh clone
// per the README, matching the fresh-clone test the submission itself
// gets held to.
export default defineConfig({
  testDir: "./tests/e2e",
  // Serialized, not parallel: the dev server compiles routes on demand, so
  // several workers hitting /w/[id] at once race the same first compile and
  // spuriously time out. One worker means each route compiles once, then
  // every later navigation is instant. (These tests are fast; serial is fine.)
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_USE_MOCK: "true", NEXT_PUBLIC_SIM_ADMIN: "true" },
    timeout: 30_000,
  },
});
