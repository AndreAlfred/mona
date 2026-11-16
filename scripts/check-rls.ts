/**
 * Proves the database keeps each person's rows to themselves, against the
 * real Supabase project. Makes two throwaway users, has each save some
 * history, then has A try to read, change, delete and overwrite B's rows,
 * and has someone signed out try everything. Deletes both users at the end.
 *
 *   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SECRET_KEY=… npx tsx scripts/check-rls.ts
 *
 * The secret key bypasses row-level security; it is only used here, to make
 * and delete the test users and to look at what really happened. Never put
 * it in the site, the repo or Vercel.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = need("SUPABASE_URL");
const publishable = need("SUPABASE_PUBLISHABLE_KEY");
const admin = createClient(url, need("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const client = () => createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });

async function makeUser(label: string) {
  const email = `rls-check-${label}-${randomBytes(4).toString("hex")}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const sb = client();
  const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, sb };
}

const work = (key: string) => ({ key, title: `Title ${key}`, artist: "Someone", date: null, thumb: "" });

async function save(sb: SupabaseClient, key: string) {
  const now = new Date().toISOString();
  const a = await sb.rpc("push_seen", { items: [{ ...work(key), seen_at: now }] });
  const b = await sb.rpc("push_collected", { items: [{ ...work(key), collected_at: now, removed_at: null }] });
  const c = await sb.rpc("push_feed_state", { seed: 7, visited: [key], last_period: null, current: null, position_at: now });
  if (a.error || b.error || c.error) throw a.error ?? b.error ?? c.error;
}

/** What B really has, seen with the secret key. */
async function truth(id: string) {
  const [s, c, f] = await Promise.all([
    admin.from("seen").select("key, title").eq("user_id", id),
    admin.from("collected").select("key, title").eq("user_id", id),
    admin.from("feed_state").select("visited_artists, cleared_at").eq("user_id", id).maybeSingle(),
  ]);
  return { seen: s.data ?? [], collected: c.data ?? [], feed: f.data };
}

async function main() {
  const users: string[] = [];
  try {
    const A = await makeUser("a");
    users.push(A.id);
    const B = await makeUser("b");
    users.push(B.id);
    await save(A.sb, "w/a-work");
    await save(B.sb, "w/b-work");
    const before = JSON.stringify(await truth(B.id));
    check((await truth(B.id)).seen.length === 1, "B's history was saved");

    // Reading
    for (const table of ["seen", "collected", "feed_state"]) {
      const all = await A.sb.from(table).select("*");
      check(!all.error && all.data!.every((r) => r.user_id === A.id) && all.data!.length === 1, `A reading ${table} sees only A's row`);
      const theirs = await A.sb.from(table).select("*").eq("user_id", B.id);
      check(!theirs.error && theirs.data!.length === 0, `A asking for B's ${table} gets nothing`);
    }

    // Changing, deleting, writing into B's account
    for (const table of ["seen", "collected"]) {
      await A.sb.from(table).update({ title: "changed by A" }).eq("user_id", B.id);
      await A.sb.from(table).delete().eq("user_id", B.id);
      const ins = await A.sb.from(table).insert({ ...work("w/planted"), user_id: B.id, seen_at: new Date().toISOString(), collected_at: new Date().toISOString() });
      check(Boolean(ins.error), `A inserting a row into B's ${table} is refused`);
    }
    await A.sb.from("feed_state").update({ visited_artists: ["planted"] }).eq("user_id", B.id);
    await A.sb.from("feed_state").delete().eq("user_id", B.id);
    const moved = await A.sb.from("seen").update({ user_id: B.id }).eq("user_id", A.id).select();
    check(Boolean(moved.error) || moved.data!.length === 0, "A can't hand its own rows over to B");
    // The functions take user_id from the sign-in, whatever the request says.
    await A.sb.rpc("push_seen", { items: [{ ...work("w/via-rpc"), user_id: B.id, seen_at: new Date().toISOString() }] });
    await A.sb.rpc("clear_my_data");
    check(JSON.stringify(await truth(B.id)) === before, "after all that, B's rows are exactly as they were");
    const a = await truth(A.id);
    check(a.seen.length === 0 && a.feed?.cleared_at != null, "A's clear_my_data cleared only A");

    // Signed out
    const anon = client();
    for (const table of ["seen", "collected", "feed_state"]) {
      const r = await anon.from(table).select("*");
      check(Boolean(r.error) || r.data!.length === 0, `signed out, reading ${table} gets nothing`);
      const ins = await anon.from(table).insert({ ...work("w/anon"), user_id: B.id });
      check(Boolean(ins.error), `signed out, writing ${table} is refused`);
    }
    for (const fn of ["push_seen", "push_collected", "clear_my_data"]) {
      const args = fn === "clear_my_data" ? {} : { items: [] };
      const r = await anon.rpc(fn, args);
      check(Boolean(r.error), `signed out, calling ${fn} is refused`);
    }
    check(JSON.stringify(await truth(B.id)) === before, "B's rows are still untouched");
  } finally {
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      console.log(error ? `could not delete test user ${id}: ${error.message}` : `deleted test user ${id}`);
    }
    if (users.length) {
      const left = await admin.from("seen").select("key", { count: "exact", head: true }).in("user_id", users);
      console.log(`rows left behind by test users: ${left.count ?? "?"}`);
    }
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall privacy checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
