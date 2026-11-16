import { expect, test, type Page } from "@playwright/test";

/**
 * Dark mode: follows the phone until the reader taps the half-moon in the
 * masthead, and remembers that choice on this device.
 */

const LIGHT = "rgb(255, 255, 255)";
const DARK = "rgb(21, 19, 15)";

const paper = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
const saved = (page: Page) => page.evaluate(() => localStorage.getItem("mona:theme"));
const barColours = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content));

test.describe("on a phone set to light", () => {
  test.use({ colorScheme: "light" });

  test("starts light, goes dark on a tap, and stays dark", async ({ page }) => {
    await page.goto("/history");
    expect(await paper(page)).toBe(LIGHT);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect.poll(() => paper(page)).toBe(DARK);
    expect(await saved(page)).toBe("dark");
    expect(await barColours(page)).toEqual(["#15130f", "#15130f"]);

    await page.reload();
    expect(await paper(page)).toBe(DARK);
    await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();

    // Moving to another page keeps it.
    await page.getByRole("link", { name: "Collection" }).click();
    await expect(page.getByRole("heading", { name: "Collection" })).toBeVisible();
    expect(await paper(page)).toBe(DARK);
    await expect.poll(() => barColours(page)).toEqual(["#15130f", "#15130f"]);

    // So does a work's own page, which is rendered on request.
    await page.goto("/w/holbein-ambassadors");
    await expect(page.locator("article")).toBeVisible({ timeout: 20_000 });
    expect(await paper(page)).toBe(DARK);
    expect(await barColours(page)).toEqual(["#15130f", "#15130f"]);
  });

  test("tapping back to light goes back to following the phone", async ({ page }) => {
    await page.goto("/history");
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect.poll(() => paper(page)).toBe(LIGHT);
    expect(await saved(page)).toBeNull();

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => paper(page)).toBe(DARK);
  });
});

test.describe("on a phone set to dark", () => {
  test.use({ colorScheme: "dark" });

  test("starts dark with nothing saved, and can be turned light", async ({ page }) => {
    await page.goto("/history");
    expect(await paper(page)).toBe(DARK);
    expect(await saved(page)).toBeNull();

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect.poll(() => paper(page)).toBe(LIGHT);
    expect(await saved(page)).toBe("light");
  });
});

test("a long shelf can be searched, accents or not", async ({ page }) => {
  await page.goto("/history");
  await page.evaluate(() => {
    const entry = (i: number, title: string, artist: string) => ({ key: `w/x-${i}`, title, artist, thumb: "", at: Date.now() - i });
    const history = [
      entry(0, "Melencolia I", "Albrecht Dürer"),
      entry(1, "The Milkmaid", "Johannes Vermeer"),
      ...Array.from({ length: 12 }, (_, i) => entry(i + 2, `Study ${i}`, "Anon")),
    ];
    localStorage.setItem("mona:v1", JSON.stringify({ v: 1, seed: 1, history, collection: [], visitedArtists: [], requests: {} }));
  });
  await page.reload();

  await page.getByRole("searchbox", { name: "Find a work or artist" }).fill("durer melen");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("1 of 14 works seen.")).toBeVisible();

  await page.getByRole("searchbox").fill("zzz");
  await expect(page.getByText("Nothing here matches “zzz”.")).toBeVisible();
});
