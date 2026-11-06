import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests on an emulated Android phone, using the Chrome already
 * installed on this Mac (no browser download). Run with `npm run e2e`.
 * Point MONA_URL at a deployment to test that instead of a local dev server.
 *
 * These talk to the real museum APIs through Mona's archive routes, so they
 * need a network connection and can be slow when those APIs are.
 */
const url = process.env.MONA_URL;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 90_000,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: url ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "android", use: { ...devices["Pixel 7"], channel: "chrome" } }],
  webServer: url
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
