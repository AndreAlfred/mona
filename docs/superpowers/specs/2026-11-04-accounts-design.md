# Mona accounts: history and collection that survive the browser

Status: draft for Andrew's approval · 2026-11-04

## Why

Everything personal in Mona (history, collection, where you are in the
feed) lives in the browser's `localStorage` on one device. Andrew's friend
uses Android and reports that his history doesn't save. The likely cause is
the browser itself: links opened inside chat or social apps open in that
app's built-in browser, which often wipes or separates its storage. Asking
the browser to keep storage can't fix that, and if it refuses, the reader
has no way to act on it.

The friend has said he'd make an account if it keeps his history. Andrew
already has a Supabase account. He is a new developer and wants Mona to
have real accounts partly as experience with a service like that: sign-in,
a hosted Postgres database, and the security rules around it. Claude builds
it, then explains the architecture and the stack choices to him.

## Goals

- A reader can sign in and have their **history, collection and feed
  position** (visited artists, the artist run in progress, the feed's seed)
  kept on the server and restored on any browser or phone they sign in on.
- Mona works exactly as it does now **without** signing in. Accounts are
  optional.
- Signing in on a device that already has history **merges** it into the
  account; nothing is lost either way.
- Each person's data is private to them, enforced by the database itself,
  not just by the app's code (the repo is public).
- Andrew ends up understanding how it fits together: a plain-language
  write-up in the repo and a walkthrough in chat after it ships.

## Non-goals

- Social features, sharing between accounts, public profiles.
- Moving the research passphrase or research requests into accounts. They
  stay as they are.
- Asking the browser for persistent storage, or warnings when it won't
  persist (considered and set aside by Andrew).
- Open sign-up for the public.
- Recording history from single-work share pages (`/w/<id>`). Andrew judged
  it a minor contributor; it can follow separately.

## Anti-goals: failures even if it "works"

- Mona gets slower, or stops working, when signed out, offline, or when
  Supabase is unreachable or paused. Reads always come from the device.
- One person can read or change another person's rows.
- A secret key (Supabase service-role key, database password, access
  token) ends up in the browser, the repo, or a Vercel `NEXT_PUBLIC_` variable.
- A second device's sign-in silently overwrites the first device's history
  or collection.
- Mona starts sending email, or depends on an email service.

## Constraints

- Zero running cost: Supabase free tier, Vercel Hobby.
- Free Supabase projects **pause after about a week with no activity**.
  Data is kept; the project has to be restored from the dashboard. Mona
  must degrade gracefully when that happens (see Sync).
- Supabase's built-in email only delivers to members of the project's own
  team and is limited to 2 messages an hour (since 2024-09-26). Email
  codes or magic links for the friend would need custom SMTP, which this
  design avoids.
- The repo is public. Anything in the browser bundle is public.
- Next.js 16 App Router, client-side state in `lib/store.ts`
  (`DeviceState`, `useDevice`, `update`). The app has no server-side
  sessions today and doesn't need them for this.

## Decided by Andrew

- Use Supabase.
- Accounts are worth it, at a small scale, partly for the learning.
- Claude builds it and explains the architecture afterwards (Postgres and
  the rest are new to Andrew).

## Claude's calls (Andrew can override)

1. **Sign-in is email + password, with no emails sent.** "Confirm email"
   is off. Public sign-up is **closed**: Andrew creates each account in the
   Supabase dashboard (Authentication → Add user, auto-confirm) and gives
   the person their password. A forgotten password is reset by Andrew in
   the dashboard. Why: it works in any browser, including in-app ones, with
   no email service. Android's password manager can refill it if the
   browser forgets the login.
2. **The browser talks to Supabase directly** with the public
   "publishable" (anon) key, and Postgres **row-level security (RLS)**
   restricts every row to its owner. There are no new Next.js API routes
   and no service-role key anywhere in Mona.
3. **The device stays the working copy.** The app keeps reading
   `localStorage` as now. Sync runs alongside it: changes are queued in a
   local outbox and sent up, and the server's changes are pulled down and
   merged in.
4. Signing out stops syncing and **keeps** the device's local copy.
5. Schema changes live in the repo as SQL migration files.

## Design

### Data (Postgres, `public` schema)

All three tables have RLS enabled. Each has one policy per operation
allowing it only where `user_id = (select auth.uid())`. `user_id` defaults
to `auth.uid()` and references `auth.users` with `on delete cascade`.

- `seen`: one row per work a person has seen. Columns: `user_id`, `key`
  (as in `Entry.key`, e.g. `w/<id>`, `a/cma-123`), `title`, `artist`,
  `date`, `thumb`, `seen_at`, `updated_at`. Primary key `(user_id, key)`.
  On conflict, keep the earliest `seen_at`.
- `collected`: same shape, with `collected_at` and `removed_at` (null while
  collected). Un-collecting sets `removed_at` rather than deleting the row,
  so the removal reaches other devices instead of being undone by them.
- `feed_state`: one row per person. Columns: `seed`, `visited_artists`
  (text[]), `last_period`, `current` (jsonb, the `{artist, shown}` run in
  progress), `cleared_at`, `updated_at`. Merged field by field (see Merge
  rules).

`updated_at` is set by the database on insert and update (a trigger), so
devices can ask for "what changed since I last looked" in one query.

### Sync (new `lib/sync.ts`, hooked into `lib/store.ts`)

- **Outbox.** When signed in, every `recordSeen`, `toggleCollected`,
  `markArtistVisited` and `setCurrent` also queues an upsert in an outbox
  kept in `localStorage`. The outbox flushes a couple of seconds after a
  change, when the page is hidden, and on app open. A failed flush keeps
  the queue and retries later; the reader never waits on it.
- **Pull.** On app open (and on sign-in), fetch rows with `updated_at`
  after the device's last pull time and merge them into local state:
  - history is a union
  - collection applies `removed_at`
  - feed state takes the newer `updated_at`
- **First sign-in on a device.** Upload the device's existing history,
  collection and feed state, then pull. Before uploading, check which
  account this device last synced with. If it was a different person,
  don't upload their local data into this account. Instead, ask whether
  to clear it from the device.
- **Supabase unreachable or paused.** Sync stops quietly and retries on
  the next open. The account page says the account can't be reached right
  now; the feed and pages behave exactly as when signed out.
- The Supabase session is stored by `supabase-js` in the browser. If the
  browser wipes storage, the person signs in again and the pull restores
  everything.

### Merge rules (Claude's calls, settled after the builder check)

- **Where sync hooks in.** Sync hooks into `update()` in `lib/store.ts` by
  comparing the old and new state, not into the individual functions. That
  way every write path is covered, including `importState` and the
  per-card `current.shown` bump in `Feed.tsx`. Feed-state writes are
  coalesced into one debounced upsert, not one per card.
- **Feed position follows the person.**
  - The account has one `seed`. The first device to sync sets it; every
    device that signs in afterwards adopts it, so both phones walk the
    same path.
  - `visited_artists` is merged as a union, never last-write-wins, so no
    device can drop another's artists. Changing its length only affects the
    next artist chosen, never the run in progress.
  - `current` (the run in progress) and `last_period` take the newer
    `updated_at`.
- **History.** History is a union keyed by `key`. `Entry.at` maps to
  `seen_at`, and the earliest wins. The local copy keeps its existing cap
  of the 5,000 most recent entries; the server keeps everything. Pulls are
  incremental (`updated_at` after the last pull), so old rows beyond the
  local cap are not re-added on every pull.
- **Collection.** Per key, the latest event wins: collecting sets
  `collected_at = now` and clears `removed_at`; removing sets
  `removed_at = now`. This means collect → remove → collect again ends
  collected. Timestamps come from the device clock, which is good enough
  for two people.
- **Whose device is this.** The device records which account it last
  synced as (`syncedUser` in `DeviceState`).
  - No recorded account: the local data counts as the person's own and is
    uploaded on first sign-in.
  - A different recorded account: before signing in, Mona says the phone
    has someone else's saved history, and that signing in replaces it on
    this phone. Their account copy is untouched. Cancelling means not
    signing in. Nothing is ever uploaded into the wrong account.
- **Delete my saved data.** This deletes the person's rows, clears the
  device's local history, collection, feed state and outbox, and signs
  out. It also sets a `cleared_at` time on the `feed_state` row (which is
  kept), so other signed-in devices clear their local copies on their next
  pull instead of re-uploading them.

### Screens

- **History and Collection pages, signed out:** one quiet line along the
  lines of "Saved on this phone only. Sign in to keep it on any device",
  linking to `/account`.
- **`/account`:**
  - Signed out: an email and password form that works with password
    managers (`autocomplete` attributes).
  - Signed in: the email, when it last synced, **Sign out**, and **Delete
    my saved data**. That last one deletes the person's rows (RLS allows
    it) and leaves the account for Andrew to remove.
- The masthead gains nothing new. The account is reached from History and
  Collection, to keep the masthead as calm as it is.
- Visual style follows the existing museum-label look (Instrument Serif,
  Newsreader, small caps, oxblood accent).

### Configuration

- Vercel and `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These are public by design; RLS
  is what protects the data. If they're unset, accounts are hidden and
  Mona behaves exactly as today.
- Supabase settings: email provider on, sign-ups disabled, "Confirm email"
  off.
- Andrew creates the Supabase project and the two user accounts.
  Migrations are applied with the Supabase CLI, using an access token
  collected through the secure secret prompt, never pasted in chat.

### Testing

- Unit tests (vitest) for the merge rules: union of history, earliest
  `seen_at`, removal winning over a stale collect, newer feed state
  winning, and refusing to upload a different user's local data.
- An RLS check against the real project with two throwaway users. User A
  can't select, update or delete B's rows, and a request without a session
  sees nothing. The users are deleted afterwards.
- Browser test (Playwright, the existing Pixel 7 setup):
  - Sign in on one browser context, see works, then sign in on a fresh
    context and see the same history and collection.
  - With Supabase blocked, the feed still loads and history still records
    locally.

### Deliverables beyond code

- `docs/accounts.md`: a plain-language explainer for Andrew. It covers what
  Postgres is, tables and rows, what Auth does, what RLS is and why the
  public key is safe, the outbox-and-pull sync, and what happens when the
  project pauses.
- A walkthrough of the same in chat after it ships.
- A short README section: creating and resetting accounts, and restoring
  a paused project.

## Left to the builder

- Whether to use `@supabase/supabase-js` alone or with `@supabase/ssr`
  (nothing here needs server-side sessions).
- Batch sizes, debounce timing, and pull paging.
- Exact copy and layout of `/account` and the sign-in line, within the
  existing style.
- Whether a scheduled keep-alive request is worth adding to stop the free
  project pausing. Find out what Supabase counts as activity first.
- How to stage the release: for example the schema and RLS first, then
  sync, then the screens.
