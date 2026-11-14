/**
 * The rules for keeping a device and an account in step, as pure functions
 * (no network, no storage) so they can be tested on their own.
 *
 * - diffState: given the device's state before and after a change, what to
 *   send to the account (the "outbox").
 * - applyRemote: given rows pulled from the account, the device's new state.
 *
 * The same rules hold on the server (supabase/migrations/*_accounts.sql):
 * history keeps the earliest time a work was seen, the collection takes the
 * newest collect-or-remove, visited artists are a union, and the run in
 * progress follows whichever device moved most recently.
 */
import type { DeviceState, Entry } from "./store";

export const HISTORY_CAP = 5000;

export type SeenRow = { key: string; title: string; artist: string; date: string | null; thumb: string; seen_at: string };
export type CollectedRow = Omit<SeenRow, "seen_at"> & { collected_at: string; removed_at: string | null };
export type FeedRow = {
  seed: number | null;
  visited_artists: string[];
  last_period: string | null;
  current: DeviceState["current"] | null;
  position_at: string | null;
  cleared_at: string | null;
  updated_at: string;
};

/** Changes waiting to be sent, coalesced by work so the queue never grows past the history. */
export type Outbox = {
  seen: Record<string, SeenRow>;
  collected: Record<string, CollectedRow>;
  /**
   * The feed row is sent whole, from the device's state at the time of
   * sending. 0 when there's nothing to send; otherwise counts up with each
   * change, so a change made while sending isn't forgotten.
   */
  feed: number;
};

export const emptyOutbox = (): Outbox => ({ seen: {}, collected: {}, feed: 0 });

export const isEmpty = (o: Outbox) => !o.feed && !Object.keys(o.seen).length && !Object.keys(o.collected).length;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (t: string | null | undefined) => (t ? Date.parse(t) : -Infinity);

function fields(e: Entry) {
  return { key: e.key, title: e.title, artist: e.artist, date: e.date ?? null, thumb: e.thumb };
}

/** Adds what changed between prev and next to the outbox (returns a new outbox). */
export function diffState(prev: DeviceState, next: DeviceState, outbox: Outbox, now = Date.now()): Outbox {
  let out = outbox;
  const touch = () => (out === outbox ? (out = { seen: { ...outbox.seen }, collected: { ...outbox.collected }, feed: outbox.feed }) : out);

  if (prev.history !== next.history) {
    const before = new Map(prev.history.map((e) => [e.key, e.at]));
    for (const e of next.history) {
      const at = before.get(e.key);
      // New, or moved earlier (an import can do that).
      if (at === undefined || e.at < at) touch().seen[e.key] = { ...fields(e), seen_at: iso(e.at) };
    }
  }

  if (prev.collection !== next.collection) {
    const before = new Map(prev.collection.map((e) => [e.key, e]));
    const after = new Map(next.collection.map((e) => [e.key, e]));
    for (const [key, e] of after) {
      const was = before.get(key);
      if (!was || was.at !== e.at) touch().collected[key] = { ...fields(e), collected_at: iso(e.at), removed_at: null };
    }
    for (const [key, e] of before) {
      if (!after.has(key)) touch().collected[key] = { ...fields(e), collected_at: iso(e.at), removed_at: iso(Math.max(now, e.at + 1)) };
    }
  }

  if (
    prev.seed !== next.seed ||
    prev.visitedArtists !== next.visitedArtists ||
    prev.lastPeriod !== next.lastPeriod ||
    prev.current?.artist !== next.current?.artist ||
    prev.current?.shown !== next.current?.shown
  ) {
    touch().feed = outbox.feed + 1;
  }
  return out;
}

/** Everything on the device, as an outbox: what a device uploads the first time it signs in. */
export function outboxFor(state: DeviceState): Outbox {
  const blank = { ...state, history: [], collection: [], visitedArtists: [], seed: Number.NaN, current: undefined };
  return diffState(blank, state, emptyOutbox());
}

/** Takes sent items back out of the outbox, unless they changed again while being sent. */
export function withoutSent(outbox: Outbox, sent: Outbox): Outbox {
  const seen = { ...outbox.seen };
  const collected = { ...outbox.collected };
  for (const [k, v] of Object.entries(sent.seen)) if (seen[k] === v) delete seen[k];
  for (const [k, v] of Object.entries(sent.collected)) if (collected[k] === v) delete collected[k];
  return { seen, collected, feed: outbox.feed === sent.feed ? 0 : outbox.feed };
}

export type Remote ={ seen: SeenRow[]; collected: CollectedRow[]; feed: FeedRow | null };

/**
 * Merges rows pulled from the account into the device's state.
 *
 * `pulledBefore` is the feed row's updated_at from the device's previous
 * pull. If the account was cleared since then, the device's copy is wiped
 * first. A device that has never pulled (undefined) keeps its data: it is
 * the person's own, and is about to be uploaded.
 *
 * `pending` is the outbox not yet sent, so a removal made on this device a
 * moment ago isn't undone by an older "collected" row from the account.
 */
export function applyRemote(local: DeviceState, remote: Remote, pulledBefore: string | undefined, pending: Outbox = emptyOutbox()): DeviceState {
  let s = local;
  const f = remote.feed;

  if (f?.cleared_at && pulledBefore !== undefined && ms(f.cleared_at) > ms(pulledBefore)) {
    s = { ...s, history: [], collection: [], visitedArtists: [], current: undefined, lastPeriod: undefined, positionAt: undefined };
  }

  if (remote.seen.length) {
    const byKey = new Map(s.history.map((e) => [e.key, e]));
    let changed = false;
    for (const r of remote.seen) {
      const at = ms(r.seen_at);
      const mine = byKey.get(r.key);
      if (!mine || at < mine.at) {
        byKey.set(r.key, { key: r.key, title: r.title, artist: r.artist, date: r.date ?? undefined, thumb: r.thumb, at });
        changed = true;
      }
    }
    if (changed) s = { ...s, history: [...byKey.values()].sort((a, b) => b.at - a.at).slice(0, HISTORY_CAP) };
  }

  if (remote.collected.length) {
    const byKey = new Map(s.collection.map((e) => [e.key, e]));
    let changed = false;
    for (const r of remote.collected) {
      const mine = byKey.get(r.key);
      const waiting = pending.collected[r.key];
      const remoteAt = Math.max(ms(r.collected_at), ms(r.removed_at));
      // Something on this device is newer: a pending change, or a collect made after the account's event.
      if (waiting && Math.max(ms(waiting.collected_at), ms(waiting.removed_at)) >= remoteAt) continue;
      if (r.removed_at) {
        if (mine && mine.at < ms(r.removed_at)) {
          byKey.delete(r.key);
          changed = true;
        }
      } else if (!mine) {
        byKey.set(r.key, { key: r.key, title: r.title, artist: r.artist, date: r.date ?? undefined, thumb: r.thumb, at: ms(r.collected_at) });
        changed = true;
      }
    }
    if (changed) s = { ...s, collection: [...byKey.values()].sort((a, b) => b.at - a.at) };
  }

  if (f) {
    const visited = [...s.visitedArtists];
    const have = new Set(visited);
    for (const a of f.visited_artists ?? []) if (!have.has(a)) visited.push(a);
    if (visited.length !== s.visitedArtists.length) s = { ...s, visitedArtists: visited };
    // Every device walks the account's path.
    if (f.seed != null && Number(f.seed) !== s.seed) s = { ...s, seed: Number(f.seed) };
    const theirs = ms(f.position_at);
    if (theirs > (s.positionAt ?? -Infinity)) {
      s = { ...s, current: f.current ?? undefined, lastPeriod: f.last_period ?? s.lastPeriod, positionAt: theirs };
    }
  }
  return s;
}

/** The latest updated_at among rows, for the next pull's cursor. */
export function newestUpdate(rows: { updated_at: string }[], prev: string | undefined) {
  let best = prev;
  for (const r of rows) if (!best || ms(r.updated_at) > ms(best)) best = r.updated_at;
  return best;
}
