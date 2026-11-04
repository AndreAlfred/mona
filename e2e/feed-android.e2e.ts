import { expect, test, type Page } from "@playwright/test";

/**
 * Moving from one artist to the next on an Android phone. A friend on
 * Android found this awkward: the "tap to leave" button was hidden on touch
 * screens, nothing happened for seconds after letting go, and the page then
 * scrolled only part of the way to the new artist.
 */

// Start partway through Vermeer with 9 works already shown, so the feed
// shows one work and then the end-of-artist panel.
async function startAtEndOfVermeer(page: Page) {
  await page.goto("/history");
  await page.evaluate(() =>
    localStorage.setItem(
      "mona:v1",
      JSON.stringify({
        v: 1,
        seed: 42,
        history: [],
        collection: [],
        visitedArtists: ["johannes-vermeer"],
        lastPeriod: "baroque",
        current: { artist: "johannes-vermeer", shown: 9 },
        requests: {},
      }),
    ),
  );
  await page.goto("/");
  const panel = page.getByText("End of this run");
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // A reader spends a few seconds here; the next artist loads meanwhile.
  await page.waitForTimeout(6000);
}

/** A real touch drag upwards, sent the way Android Chrome sends it. */
async function pullUp(page: Page, distance: number) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, y?: number) =>
    cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints: y === undefined ? [] : [{ x: 200, y }] });
  const from = 700;
  await touch("touchStart", from);
  for (let y = from; y >= from - distance; y -= 20) {
    await touch("touchMove", y);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
}

/** The new artist is at the top of the screen, picture loaded, with a line naming who came before. */
async function expectNewArtistArrived(page: Page, within: number) {
  await expect(page.getByText(/^After Johannes Vermeer/)).toBeVisible({ timeout: within });
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(10);
  const first = page.locator("article").first();
  await expect(first).toBeInViewport();
  await expect(first).not.toContainText("Johannes Vermeer");
  await expect
    .poll(() => first.locator("img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), {
      timeout: 5000,
    })
    .toBe(true);
}

test("the Next artist button is visible on a touch phone and leaves at once", async ({ page }) => {
  await startAtEndOfVermeer(page);
  const next = page.getByRole("button", { name: "Next artist" });
  await expect(next).toBeVisible();
  await next.tap();
  await expectNewArtistArrived(page, 1500);
});

test("pulling up past the end moves to a new artist", async ({ page }) => {
  await startAtEndOfVermeer(page);
  await pullUp(page, 320);
  await expectNewArtistArrived(page, 1500);
});

test("a short pull springs back and stays put", async ({ page }) => {
  await startAtEndOfVermeer(page);
  await pullUp(page, 60);
  await page.waitForTimeout(800);
  await expect(page.getByText("End of this run")).toBeVisible();
  await expect(page.getByText(/^After /)).toHaveCount(0);
});

test("the new artist's works arrive one at a time, not all at once", async ({ page }) => {
  await startAtEndOfVermeer(page);
  await page.getByRole("button", { name: "Next artist" }).tap();
  await expectNewArtistArrived(page, 1500);
  await page.waitForTimeout(3000);
  // Without scrolling, only the first card and a couple ahead should be on the page.
  expect(await page.locator("article").count()).toBeLessThanOrEqual(3);
});
