import { devices, expect, test, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

/**
 * Against a deployed Mona (MONA_URL=https://…): tapping Continue with Google
 * reaches Google's own sign-in screen, with no setup error (a wrong redirect
 * URI or client ID shows up here as "Error 400" or "Access blocked"). It
 * stops at Google's screen; it doesn't sign in.
 *
 * With SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY also
 * set, a second test syncs between two "phones" through the real account
 * database, as a throwaway user (deleted afterwards). Tests can't sign in to
 * Google, so each phone gets a session made with a test password instead;
 * everything after sign-in is the real thing.
 */
test("Continue with Google reaches Google's sign-in screen", async ({ page, baseURL }) => {
  test.skip(!baseURL?.startsWith("https://"), "only against a deployment");
  await page.goto("/account");
  const google = page.getByRole("button", { name: "Continue with Google" });
  const off = page.getByText("Accounts aren’t switched on yet");
  await expect(google.or(off)).toBeVisible({ timeout: 15_000 });
  test.skip(await off.isVisible(), "accounts are off on this deployment");

  await google.click();
  await page.waitForURL(/accounts\.google\.com/, { timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText(/redirect_uri_mismatch|invalid_client|Access blocked|Error 40\d/i, { timeout: 5000 });
  await expect(page.locator("body")).toContainText(/Sign in|Choose an account|Email or phone/i);
  console.log("Google says:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200));
});

const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, secret: process.env.SUPABASE_SECRET_KEY };

async function phone(browser: Browser, session: unknown) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await page.goto("/history");
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("mona:auth", JSON.stringify(s));
  }, session);
  return { ctx, page };
}

test("a work collected on one phone shows up on another", async ({ browser, baseURL }) => {
  test.skip(!baseURL?.startsWith("https://") || !env.url || !env.key || !env.secret, "needs a deployment and the Supabase keys");
  const admin = createClient(env.url!, env.secret!, { auth: { persistSession: false } });
  const email = `mona-e2e-${randomBytes(4).toString("hex")}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const signIn = async () => {
    const c = createClient(env.url!, env.key!, { auth: { persistSession: false } });
    const r = await c.auth.signInWithPassword({ email, password });
    if (r.error) throw r.error;
    return r.data.session;
  };
  try {
    // Phone A reads a work and collects it.
    const a = await phone(browser, await signIn());
    await a.page.goto("/w/holbein-ambassadors");
    await a.page.getByRole("button", { name: "Collect", exact: true }).click();
    await expect(a.page.getByRole("button", { name: "Collected" })).toBeVisible();
    // Sent within a couple of seconds; wait for the outbox to empty.
    await expect
      .poll(
        () =>
          a.page.evaluate(() => {
            const o = JSON.parse(localStorage.getItem("mona:outbox") ?? "{}");
            return Object.keys(o.seen ?? {}).length + Object.keys(o.collected ?? {}).length + (o.feed ?? 0);
          }),
        { timeout: 20_000 },
      )
      .toBe(0);
    const rows = await admin.from("collected").select("key").eq("user_id", data.user.id);
    expect(rows.data?.map((r) => r.key)).toEqual(["w/holbein-ambassadors"]);

    // Phone B, a different browser, signs in and gets it.
    const b = await phone(browser, await signIn());
    await b.page.goto("/collection");
    await expect(b.page.getByText("The Ambassadors")).toBeVisible({ timeout: 20_000 });
    await expect(b.page.getByText("Kept in your account.")).toBeVisible();
    await b.page.goto("/history");
    await expect(b.page.getByText("The Ambassadors")).toBeVisible();
    await a.ctx.close();
    await b.ctx.close();
  } finally {
    await admin.auth.admin.deleteUser(data.user.id);
  }
});
