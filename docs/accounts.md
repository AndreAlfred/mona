# How Mona's accounts work

A plain-language tour of the accounts feature: what each piece is, why it
was chosen, and what to do when something goes wrong. The design and its
decisions are in
[`superpowers/specs/2026-11-04-accounts-design.md`](superpowers/specs/2026-11-04-accounts-design.md).

## The problem it solves

Mona keeps everything personal (the works you've seen, your collection,
where you are in the feed) in the browser's own storage, `localStorage`.
That's fast and private, but it lives and dies with one browser on one
phone. If the browser clears it (some apps' built-in browsers do this
constantly), it's gone.

An account keeps a copy on a server, so signing in on any browser brings it
back.

## The pieces

```
 phone (Mona in the browser)                     Supabase (hosted)
 ┌──────────────────────────────┐               ┌──────────────────────────┐
 │ localStorage "mona:v1"       │  push_seen()  │ Auth: who you are        │
 │   history, collection, feed  │ ────────────▶ │   asks Google who you are│
 │ localStorage "mona:outbox"   │  select ...   │ Postgres database        │
 │   changes not yet sent       │ ◀──────────── │   seen, collected,       │
 │ localStorage "mona:auth"     │               │   feed_state             │
 │   your sign-in (a token)     │               │   + row-level security   │
 └──────────────────────────────┘               └──────────────────────────┘
                                                   │ "is this really them?"
                                                   ▼
                                                 Google sign-in
```

### Postgres: the database

Postgres is a database: a program that stores data in **tables**. A table
is like a spreadsheet with fixed columns, and each **row** is one record.
Mona has three tables:

| Table | One row per | Columns (main ones) |
|---|---|---|
| `seen` | work a person has seen | `user_id`, `key` (e.g. `w/holbein-ambassadors`), `title`, `artist`, `thumb`, `seen_at` |
| `collected` | work a person has collected (or un-collected) | same, plus `collected_at`, `removed_at` |
| `feed_state` | person | `seed`, `visited_artists`, `current` (the artist run in progress), `cleared_at` |

Every row has a `user_id`, the person it belongs to, and an `updated_at`,
the time the database last changed it. You talk to Postgres in **SQL**, a
language for asking questions of tables: `select key, title from seen where
user_id = '…'` means "give me the key and title of this person's seen works".

The tables are defined in
[`supabase/migrations/20261114000000_accounts.sql`](../supabase/migrations/20261114000000_accounts.sql).
A **migration** is a file of SQL that changes the database's shape. Keeping
them in the repo means the database's design is versioned with the code.

### Supabase: Postgres plus the parts around it

Supabase is a hosted Postgres with extras:

- **Auth.** It keeps the list of people (`auth.users`), checks who someone
  is (here, by asking Google), and hands the browser a **token**: a signed note saying
  "this is user 1234, valid for an hour", which the browser then sends
  with every request. The token renews itself in the background.
- **A web API over the database (PostgREST).** The browser can run
  queries over HTTPS, like `GET /rest/v1/seen?updated_at=gt.…`, without
  Mona needing its own server code.

Mona's site on Vercel isn't involved at all: the browser talks to Supabase
directly (`lib/supabase.ts`).

### Row-level security: why a public key is safe

The browser connects with the **publishable key**, and anyone can read it
from Mona's JavaScript. So what stops someone using it to read your
history? **Row-level security (RLS).** Each table has rules ("policies")
that Postgres checks on every single row:

```sql
create policy "own rows: read" on public.seen for select to authenticated
  using (user_id = (select auth.uid()));
```

That says: a signed-in person can only see rows where `user_id` is their
own id, and `auth.uid()` comes from the signed token, which can't be
forged without Supabase's secret. Someone who isn't signed in gets nothing
(`revoke all … from anon`). The same goes for adding, changing and
deleting rows. The database enforces this, so a bug in Mona's JavaScript
couldn't leak one person's rows to another.

The keys that *can* bypass RLS (the "secret" or "service role" key, the
database password) are never in Mona's code, the repo, or Vercel.

### Sign-in with Google

1. You tap **Continue with Google**. Mona first stores a random secret in
   this browser, then sends you to Google (by way of Supabase).
2. Google asks you to choose your account (on Android, you're usually
   already signed in) and tells Supabase who you are.
3. Supabase looks for a user with that email address. Sign-up is closed,
   so if Andrew hasn't added the address, it stops there and Mona says
   "Ask Andrew to add you". If he has, the Google sign-in is attached to
   that user.
4. Supabase sends you back to `/account?code=…`. Mona trades the code,
   plus the secret from step 1, for the token, kept in `localStorage`
   under `mona:auth` (`finishSignIn` in `lib/sync.ts`).

The secret in step 1 is called **PKCE** ("proof key"). Without it, anyone
who saw the code (in browser history, say) could use it. With it, the code
only works in the browser that started the sign-in.

Mona never sees your Google password, and Google tells Supabase only your
name, email and picture.

**Inside another app's browser** (Instagram, Facebook, TikTok…), Google
refuses to sign anyone in. There the account page says so and offers
**Open in your browser**. That's the right fix anyway, since those
browsers are the ones that forget history.

Emailed 6-digit codes are built too (`requestCode` and `verifyCode`), but
switched off: they need an email sender set up in Supabase. See the README.

### Sync: the outbox and the pull

The phone stays the working copy. Mona never waits on the network to show
you anything. Sync runs alongside (`lib/sync.ts`):

- **Outbox.** Every change to your Mona state goes through one function
  (`update()` in `lib/store.ts`). Sync compares the state before and after,
  and queues what changed in `mona:outbox`. A couple of seconds later, or
  when you switch away from Mona, the queue is sent. If sending fails, the
  queue waits for next time.
- **Pull.** Then Mona asks for rows changed since its last pull ("since"
  is a time from the database's own clock, so a phone with a wrong clock
  can't miss anything) and merges them in.

The merge rules (`lib/sync-merge.ts`, also enforced by the database's
`push_*` functions):

- **History** is a union. Seen on either phone means seen; the earliest
  time wins. The phone keeps your latest 5,000; the account keeps all.
- **Collection:** for each work, the newest event wins, collect or remove.
  Un-collecting doesn't delete the row; it sets `removed_at`, so the
  removal reaches your other phones instead of being undone by them.
- **Feed:** visited artists are a union; every device adopts the account's
  random seed (so both phones walk the same path); the artist in progress
  follows whichever device moved most recently.

**Someone else's phone.** A phone remembers whose account its data belongs
to. If a different person signs in on it, Mona asks before replacing that
history on the phone. Nothing is ever uploaded into the wrong account.

**Delete my saved data** removes your rows, wipes this phone's copy, and
signs you out. It also stamps `cleared_at` on your feed row, so your other
phones wipe their copies the next time they sync instead of uploading them
again.

## When things go wrong

- **"Can't reach your account right now."** Offline, or Supabase is down
  or paused. Mona carries on as if signed out, and changes wait in the
  outbox.
- **The project paused.** Free Supabase projects pause after about a week
  with no activity. Data is kept. Restore it from the Supabase dashboard
  (the project page shows a Restore button); it takes a few minutes.
- **"That Google account isn't on Mona's list".** The person chose a
  Google account whose email isn't in Supabase → Authentication → Users.
  Add it, or have them pick the other account on Google's screen.
- **"Signing in with Google didn't finish".** Usually the sign-in started
  in one browser and came back in another (the code only works where it
  started), or they backed out on Google's screen. Try again from the
  same browser. Supabase's Auth logs say more.
- **Google says the app is unverified or blocked.** Check Google Cloud →
  Google Auth Platform → Audience: it should be External and In
  production.
- **Adding someone.** Supabase → Authentication → Users → Add user → the
  email of their Google account, "Auto confirm user" on. If it asks for a
  password, any long random one will do; nobody uses it.
- **Removing someone.** Delete the user there. Their rows go with them
  (`on delete cascade`).

## Where the code is

| File | What |
|---|---|
| `supabase/migrations/*_accounts.sql` | Tables, RLS policies, the `push_*` and `clear_my_data` functions |
| `lib/supabase.ts` | The connection; accounts are off unless both env vars are set |
| `lib/sync-merge.ts` | The merge rules, as pure functions (tested in `tests/sync-merge.test.ts`) |
| `lib/sync.ts` | Outbox, send, pull, Google sign-in, sign-out, delete |
| `lib/browser.ts` | Spots other apps' built-in browsers |
| `lib/store.ts` | The device's state; `update()` reports every change to sync |
| `components/AccountView.tsx` | The `/account` page |
| `components/SyncRunner.tsx` | Starts background sync on every page |
| `e2e/accounts-mocked.e2e.ts` | Browser tests with a stand-in Supabase and Google |
| `scripts/check-rls.ts` | Privacy check against the real project |
