import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Accounts, with Supabase played by the test: sign-in, the first upload,
 * pulling another device's history, replacing someone else's history, and
 * Mona carrying on when the account can't be reached.
 *
 * Needs a build with accounts switched on. Any URL works, since nothing
 * reaches it:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm run dev
 * Skips itself when accounts are off.
 */

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "friend@example.com" };
const OTHER = "22222222-2222-4222-8222-222222222222";

type Calls = { rpc: Record<string, unknown[]>; otp: unknown[]; verify: unknown[] };

function session() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "test-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: "test-refresh-token",
    user: { id: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

/** Fakes Supabase's auth and data API. `remote` is what the "account" holds. */
async function fakeSupabase(page: Page, remote: { seen?: unknown[]; feed?: unknown } = {}, opts: { otp?: (r: Route) => Promise<void> } = {}) {
  const calls: Calls = { rpc: {}, otp: [], verify: [] };
  await page.route(
    (u) => /\/(auth|rest)\/v1\//.test(u.pathname),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const body = req.postDataJSON?.() ?? null;
      const json = (status: number, data: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (path.endsWith("/auth/v1/otp")) {
        calls.otp.push(body);
        return opts.otp ? opts.otp(route) : json(200, {});
      }
      if (path.endsWith("/auth/v1/verify")) {
        calls.verify.push(body);
        return (body as { token?: string }).token === "123456" ? json(200, session()) : json(403, { code: "otp_expired", msg: "Token has expired or is invalid" });
      }
      if (path.endsWith("/auth/v1/logout")) return route.fulfill({ status: 204 });
      const rpc = path.match(/\/rest\/v1\/rpc\/(\w+)$/);
      if (rpc) {
        (calls.rpc[rpc[1]] ??= []).push(body);
        return json(200, rpc[1] === "clear_my_data" ? null : true);
      }
      if (path.endsWith("/rest/v1/feed_state")) {
        const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
        const rows = remote.feed ? [remote.feed] : [];
        return single ? (rows.length ? json(200, rows[0]) : json(406, { code: "PGRST116", message: "0 rows" })) : json(200, rows);
      }
      if (path.endsWith("/rest/v1/seen")) return json(200, remote.seen ?? []);
      if (path.endsWith("/rest/v1/collected")) return json(200, []);
      return json(404, {});
    },
  );
  return calls;
}

async function device(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mona:v1") ?? "{}"));
}

async function seed(page: Page, state: Record<string, unknown>) {
  await page.goto("/history");
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("mona:v1", JSON.stringify({ v: 1, seed: 5, history: [], collection: [], visitedArtists: [], requests: {}, ...s }));
  }, state);
}

const seenEntry = (key: string, minsAgo: number) => ({ key, title: `Work ${key}`, artist: "Someone", thumb: "", at: Date.now() - minsAgo * 60_000 });

async function signIn(page: Page) {
  await page.goto("/account");
  await page.getByLabel("Your email").fill(USER.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Code").fill("123456");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/account");
  const on = page.getByText("Your email");
  const off = page.getByText("Accounts aren’t switched on yet");
  await expect(on.or(off)).toBeVisible({ timeout: 15_000 });
  test.skip(await off.isVisible(), "accounts are off in this build");
});

test("History says it's only on this phone, and links to sign in", async ({ page }) => {
  await fakeSupabase(page);
  await seed(page, { history: [seenEntry("w/a", 1)] });
  await page.goto("/history");
  await expect(page.getByText("Saved on this phone only.")).toBeVisible();
  await page.getByRole("link", { name: "Sign in to keep it on any device" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("an address Andrew hasn't added is told to ask him", async ({ page }) => {
  await fakeSupabase(page, {}, {
    otp: (r) => r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ code: "otp_disabled", msg: "Signups not allowed for otp" }) }),
  });
  await page.goto("/account");
  await page.getByLabel("Your email").fill("stranger@example.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Ask Andrew to add you");
});

test("a wrong code says so, and the right one signs in and uploads this phone's history", async ({ page }) => {
  const calls = await fakeSupabase(page, { feed: { seed: 99, visited_artists: ["rembrandt-van-rijn"], last_period: null, current: null, position_at: null, cleared_at: null, updated_at: new Date().toISOString() } });
  await seed(page, { history: [seenEntry("w/a", 5), seenEntry("w/b", 3)], collection: [seenEntry("w/a", 4)], visitedArtists: ["johannes-vermeer"] });
  await page.goto("/account");
  await page.getByLabel("Your email").fill(USER.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  expect(calls.otp[0]).toMatchObject({ email: USER.email, create_user: false });
  await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();

  await page.getByLabel("Code").fill("654321");
  await expect(page.locator("p[role=alert]")).toContainText("That code didn’t work");
  await page.getByLabel("Code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(USER.email)).toBeVisible();
  await expect(page.getByText(/Synced just now/)).toBeVisible({ timeout: 10_000 });
  const seen = (calls.rpc.push_seen ?? []).flatMap((b) => (b as { items: { key: string }[] }).items.map((i) => i.key));
  expect(seen.sort()).toEqual(["w/a", "w/b"]);
  expect((calls.rpc.push_seen![0] as { pulled: unknown }).pulled).toBeNull(); // first upload: no clear check
  expect(calls.rpc.push_collected?.[0]).toMatchObject({ items: [{ key: "w/a", removed_at: null }] });
  expect(calls.rpc.push_feed_state?.[0]).toMatchObject({ seed: 5, visited: ["johannes-vermeer"] });

  // The account's seed and visited artists come back down.
  const d = await device(page);
  expect(d.syncedUser).toBe(USER.id);
  expect(d.seed).toBe(99);
  expect(d.visitedArtists).toEqual(["johannes-vermeer", "rembrandt-van-rijn"]);
  expect(d.lastPull.feed).toBeTruthy();

  await page.goto("/history");
  await expect(page.getByText("Kept in your account.")).toBeVisible();
});

test("another device's history arrives on sign-in", async ({ page }) => {
  const at = new Date(Date.now() - 86_400_000).toISOString();
  await fakeSupabase(page, {
    seen: [{ key: "w/from-phone", title: "From the other phone", artist: "Someone", date: null, thumb: "", seen_at: at, updated_at: new Date().toISOString() }],
  });
  await seed(page, {});
  await signIn(page);
  await expect(page.getByText(/Synced just now/)).toBeVisible({ timeout: 10_000 });
  await page.goto("/history");
  await expect(page.getByText("From the other phone")).toBeVisible();
});

test("someone else's history on this phone is only replaced after asking", async ({ page }) => {
  const calls = await fakeSupabase(page);
  await seed(page, { syncedUser: OTHER, history: [seenEntry("w/theirs", 2)] });
  await signIn(page);
  await expect(page.getByText("This phone has history saved by someone else’s account")).toBeVisible();
  await page.waitForTimeout(2500);
  expect(calls.rpc.push_seen ?? []).toHaveLength(0); // nothing of theirs went into this account
  expect((await device(page)).history).toHaveLength(1);

  await page.getByRole("button", { name: "Replace and sign in" }).click();
  await expect(page.getByText(/Synced just now/)).toBeVisible({ timeout: 10_000 });
  const d = await device(page);
  expect(d.syncedUser).toBe(USER.id);
  expect(d.history).toEqual([]);
  expect(calls.rpc.push_seen ?? []).toHaveLength(0);
});

test("with the account unreachable, the feed still works and changes wait in the outbox", async ({ page }) => {
  await page.route((u) => /\/(auth|rest)\/v1\//.test(u.pathname), (r) => r.abort("internetdisconnected"));
  await seed(page, { syncedUser: USER.id });
  await page.evaluate((s) => localStorage.setItem("mona:auth", JSON.stringify(s)), session());
  await page.goto("/w/holbein-ambassadors");
  await expect(page.locator("article")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await device(page)).history?.map((h: { key: string }) => h.key), { timeout: 8000 })
    .toContain("w/holbein-ambassadors");
  await expect
    .poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("mona:outbox") ?? "{}").seen ?? {})), { timeout: 8000 })
    .toContain("w/holbein-ambassadors");

  await page.goto("/account");
  await expect(page.getByText("Can’t reach your account right now")).toBeVisible({ timeout: 15_000 });
});

test("delete my saved data clears the account and this phone, then signs out", async ({ page }) => {
  const calls = await fakeSupabase(page);
  await seed(page, { history: [seenEntry("w/a", 5)] });
  await signIn(page);
  await expect(page.getByText(/Synced just now/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Delete my saved data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByLabel("Your email")).toBeVisible();
  expect(calls.rpc.clear_my_data).toHaveLength(1);
  const d = await device(page);
  expect(d.history).toEqual([]);
  expect(d.syncedUser).toBeUndefined();
});
