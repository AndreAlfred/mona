import { devices, expect, test, type Page } from "@playwright/test";

/**
 * Keeping history on Android. A friend's history wasn't sticking, most
 * likely because Mona was opened inside another app's built-in browser,
 * which can wipe storage between visits.
 */

const PIXEL_UA = devices["Pixel 7"].userAgent;
const WORK = "holbein-ambassadors";

/** Make the browser report storage as not yet persistent (Chrome may grant it on its own). */
async function storageNotPersisted(page: Page) {
  await page.addInitScript(() => {
    const s = navigator.storage;
    if (s) {
      s.persisted = async () => false;
      s.persist = async () => false;
    }
  });
}

async function seedHistory(page: Page, n: number) {
  await page.goto("/history");
  await page.evaluate((n) => {
    const history = Array.from({ length: n }, (_, i) => ({ key: `w/x-${i}`, title: `T${i}`, artist: "A", thumb: "", at: Date.now() - i }));
    localStorage.setItem("mona:v1", JSON.stringify({ v: 1, seed: 1, history, collection: [], visitedArtists: [], requests: {} }));
  }, n);
}

test("a shared link lands in History", async ({ page }) => {
  await page.goto(`/w/${WORK}`);
  await expect(page.locator("article")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mona:v1") ?? "{}").history?.map((h: { key: string }) => h.key)), {
      timeout: 5000,
    })
    .toContain(`w/${WORK}`);
});

test("plain Chrome with no history yet shows no notice", async ({ page }) => {
  await storageNotPersisted(page);
  await page.goto("/history");
  await page.waitForTimeout(1000);
  await expect(page.getByRole("note")).toHaveCount(0);
});

test.describe("inside another app's browser", () => {
  test.use({ userAgent: `${PIXEL_UA} Instagram 312.0.0.0 Android` });

  test("says history may be forgotten and offers the phone's browser", async ({ page }) => {
    await page.goto("/");
    const note = page.getByRole("note");
    await expect(note).toContainText("inside another app");
    const link = note.getByRole("link", { name: "Open in your browser" });
    await expect(link).toHaveAttribute("href", /^intent:\/\/[^#]+\/#Intent;scheme=https?;action=android\.intent\.action\.VIEW;S\.browser_fallback_url=https?%3A/);
  });

  test("Not now puts it away, and it stays away", async ({ page }) => {
    await page.goto("/history");
    await page.getByRole("button", { name: "Not now" }).tap();
    await expect(page.getByRole("note")).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(page.getByRole("note")).toHaveCount(0);
  });
});

test.describe("an Android WebView", () => {
  test.use({ userAgent: PIXEL_UA.replace("Pixel 7)", "Pixel 7; wv)") });
  test("is recognised as another app's browser", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByRole("note")).toContainText("inside another app");
  });
});

test("Chrome offers Add to Home screen once there's history worth keeping", async ({ page }) => {
  await storageNotPersisted(page);
  await seedHistory(page, 3);
  await page.goto("/history");
  // Stand in for Chrome's own install offer, which headless Chrome doesn't make.
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    e.prompt = async () => {
      (window as unknown as { prompted: boolean }).prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  const add = page.getByRole("button", { name: "Add to Home screen" });
  await expect(add).toBeVisible();
  await add.tap();
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
  await expect(page.getByRole("note")).toHaveCount(0);
});
