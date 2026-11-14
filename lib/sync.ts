"use client";
/**
 * Keeps this device and the reader's account in step.
 *
 * The device stays the working copy: every page reads localStorage exactly
 * as before, and nothing ever waits on the network. Alongside it:
 *
 * - Outbox. Every change (whichever function made it) is compared with the
 *   state before it, and what changed is queued in localStorage
 *   ("mona:outbox"). The queue is sent a couple of seconds after a change,
 *   when the page is hidden, and when Mona opens. If sending fails, the
 *   queue stays and is tried again later.
 * - Pull. After sending, Mona asks the account for rows changed since the
 *   last pull and merges them in (lib/sync-merge.ts has the rules).
 *
 * If Supabase can't be reached (offline, or the free project is paused),
 * sync stops quietly and Mona behaves exactly as when signed out.
 */
import { useSyncExternalStore } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { applyRemoteState, getState, setChangeHook, type DeviceState } from "./store";
import {
  applyRemote,
  diffState,
  emptyOutbox,
  isEmpty,
  newestUpdate,
  outboxFor,
  withoutSent,
  type CollectedRow,
  type FeedRow,
  type Outbox,
  type SeenRow,
} from "./sync-merge";
import { accountsEnabled, supabase } from "./supabase";

export { accountsEnabled };

const OUTBOX_KEY = "mona:outbox";
const BATCH = 100;
const PAGE = 1000;
/** Pulls overlap the previous one a little, in case a write was still committing. */
const OVERLAP_MS = 30_000;
const DEBOUNCE_MS = 2_000;

// ------------------------------------------------------------------ outbox

let outbox: Outbox | null = null;

function getOutbox(): Outbox {
  if (outbox) return outbox;
  try {
    outbox = { ...emptyOutbox(), ...JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "{}") };
  } catch {
    outbox = emptyOutbox();
  }
  return outbox!;
}

function setOutbox(o: Outbox) {
  outbox = o;
  try {
    if (isEmpty(o)) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(o));
  } catch {}
}

// ------------------------------------------------------------ account state

export type SyncStatus = "idle" | "syncing" | "synced" | "unreachable";
export type Account = {
  /** False until Mona has checked for a saved sign-in. */
  ready: boolean;
  session: Session | null;
  status: SyncStatus;
};

let account: Account = { ready: !accountsEnabled, session: null, status: "idle" };
const SERVER_ACCOUNT: Account = { ready: false, session: null, status: "idle" };
const listeners = new Set<() => void>();

function setAccount(patch: Partial<Account>) {
  account = { ...account, ...patch };
  listeners.forEach((l) => l());
}

let watching = false;
/**
 * Starts following the sign-in state. Readers who have never signed in on
 * this browser have no saved session, so the Supabase library isn't loaded
 * for them at all unless they open the account page (`force`).
 */
function watchAuth(force = false) {
  if (watching) return;
  const p = accountsEnabled && (force || localStorage.getItem("mona:auth")) ? supabase() : null;
  if (!p) {
    if (!account.ready) setAccount({ ready: true });
    return;
  }
  watching = true;
  p.then((sb) => {
    sb.auth.getSession().then(
      ({ data }) => setAccount({ ready: true, session: data.session }),
      () => setAccount({ ready: true }),
    );
    // Don't call Supabase from inside this callback (supabase-js warns it can deadlock).
    sb.auth.onAuthStateChange((_event, session) => setAccount({ ready: true, session }));
  }).catch(() => setAccount({ ready: true, status: "unreachable" }));
}

function subscribe(l: () => void) {
  watchAuth();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** For the account page: load Supabase and check for a sign-in even if this browser has none saved. */
export function wakeAccounts() {
  watchAuth(true);
}

/** The signed-in person, if any, and how the last sync went. */
export function useAccount(): Account {
  return useSyncExternalStore(subscribe, () => account, () => SERVER_ACCOUNT);
}

/** The person signed in now, if they are the person this device's data belongs to. */
function linkedSession(): Session | null {
  const s = account.session;
  return s && getState().syncedUser === s.user.id ? s : null;
}

// ------------------------------------------------------------------- send

type Result = "ok" | "cleared" | "unreachable" | "idle";

async function send(sb: SupabaseClient): Promise<Result> {
  const o = getOutbox();
  if (isEmpty(o)) return "ok";
  const s = getState();
  const pulled = s.lastPull?.feed ?? null;
  const sent: Outbox = { seen: {}, collected: {}, feed: 0 };
  try {
    const seen = Object.entries(o.seen);
    for (let i = 0; i < seen.length; i += BATCH) {
      const part = seen.slice(i, i + BATCH);
      const { data, error } = await sb.rpc("push_seen", { items: part.map(([, v]) => v), pulled });
      if (error) throw error;
      if (data === false) return "cleared";
      for (const [k, v] of part) sent.seen[k] = v;
    }
    const collected = Object.entries(o.collected);
    for (let i = 0; i < collected.length; i += BATCH) {
      const part = collected.slice(i, i + BATCH);
      const { data, error } = await sb.rpc("push_collected", { items: part.map(([, v]) => v), pulled });
      if (error) throw error;
      if (data === false) return "cleared";
      for (const [k, v] of part) sent.collected[k] = v;
    }
    if (o.feed) {
      const st = getState();
      const { data, error } = await sb.rpc("push_feed_state", {
        seed: st.seed,
        visited: st.visitedArtists,
        last_period: st.lastPeriod ?? null,
        current: st.current ?? null,
        position_at: st.positionAt ? new Date(st.positionAt).toISOString() : null,
        pulled,
      });
      if (error) throw error;
      if (data === false) return "cleared";
      sent.feed = o.feed;
    }
    return "ok";
  } catch {
    return "unreachable";
  } finally {
    // Whatever made it is out of the queue; anything changed meanwhile stays.
    setOutbox(withoutSent(getOutbox(), sent));
  }
}

// ------------------------------------------------------------------- pull

async function pullTable<T extends { updated_at: string }>(sb: SupabaseClient, table: string, columns: string, since?: string) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).order("updated_at").order("key").range(from, from + PAGE - 1);
    if (since) q = q.gt("updated_at", new Date(Date.parse(since) - OVERLAP_MS).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data as unknown as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function pull(sb: SupabaseClient, userId: string) {
  const last = getState().lastPull ?? {};
  const { data: feed, error } = await sb.from("feed_state").select("*").maybeSingle<FeedRow>();
  if (error) throw error;
  const seen = await pullTable<SeenRow & { updated_at: string }>(sb, "seen", "key,title,artist,date,thumb,seen_at,updated_at", last.seen);
  const collected = await pullTable<CollectedRow & { updated_at: string }>(
    sb,
    "collected",
    "key,title,artist,date,thumb,collected_at,removed_at,updated_at",
    last.collected,
  );
  if (getState().syncedUser !== userId) return; // signed out or switched while pulling
  if (feed?.cleared_at && last.feed && Date.parse(feed.cleared_at) > Date.parse(last.feed)) setOutbox(emptyOutbox());
  applyRemoteState((s) => ({
    ...applyRemote(s, { seen, collected, feed }, s.lastPull?.feed, getOutbox()),
    lastPull: {
      seen: newestUpdate(seen, last.seen),
      collected: newestUpdate(collected, last.collected),
      feed: feed?.updated_at ?? last.feed,
    },
    syncedAt: Date.now(),
  }));
}

// ------------------------------------------------------------------- sync

let running: Promise<Result> | null = null;
let queued: Promise<Result> | null = null;
let lastRun = 0;
let pullWanted = false;

/**
 * Sends the outbox, then (unless `sendOnly`) pulls. One at a time: a call
 * made during a sync runs once more after it (calls made meanwhile share
 * that one run), so a change made mid-sync is never left waiting.
 */
export function syncNow({ sendOnly = false } = {}): Promise<Result> {
  if (!sendOnly) pullWanted = true;
  if (!running) return run();
  return (queued ??= running.then(() => {
    queued = null;
    return run();
  }));
}

function run(): Promise<Result> {
  return (running = (async (): Promise<Result> => {
    const p = supabase();
    let session = account.session;
    if (!p || !session) return "idle";
    const sb = await p;
    // A device with no account's history on it belongs to whoever signs in: upload it all.
    if (!holdsSomeoneElses(session.user.id)) linkDevice(session.user.id);
    session = linkedSession();
    if (!session) return "idle"; // someone else's data is here; the account page asks first
    const wantPull = pullWanted;
    pullWanted = false;
    setAccount({ status: "syncing" });
    let r = await send(sb);
    if (r === "cleared") setOutbox(emptyOutbox()); // the pull below wipes this device's copy
    if (r !== "unreachable" && (wantPull || r === "cleared")) {
      try {
        await pull(sb, session.user.id);
        r = "ok";
      } catch {
        r = "unreachable";
      }
    }
    if (wantPull) lastRun = Date.now();
    else if (r === "ok") applyRemoteState((st) => ({ ...st, syncedAt: Date.now() }));
    setAccount({ status: r === "ok" ? "synced" : "unreachable" });
    return r;
  })().finally(() => {
    running = null;
  }));
}

/**
 * Makes this device's data belong to `userId`. If it belonged to nobody, all
 * of it is queued for upload. If it belonged to someone else (the reader has
 * agreed to this), their copy is removed from this device first; it is still
 * in their account.
 */
export function linkDevice(userId: string) {
  const s = getState();
  if (s.syncedUser === userId) return;
  if (s.syncedUser) {
    setOutbox(emptyOutbox());
    applyRemoteState((st) => ({ ...forget(st), syncedUser: userId }));
  } else {
    applyRemoteState((st) => ({ ...st, syncedUser: userId, lastPull: undefined, syncedAt: undefined }));
    setOutbox(outboxFor(getState()));
  }
}

/** True if this phone holds saved history from an account other than `userId`. */
export function holdsSomeoneElses(userId: string) {
  const s = getState();
  return Boolean(s.syncedUser && s.syncedUser !== userId && (s.history.length || s.collection.length || s.visitedArtists.length));
}

function forget(s: DeviceState): DeviceState {
  return {
    ...s,
    history: [],
    collection: [],
    visitedArtists: [],
    current: undefined,
    lastPeriod: undefined,
    positionAt: undefined,
    syncedUser: undefined,
    lastPull: undefined,
    syncedAt: undefined,
  };
}

let timer: ReturnType<typeof setTimeout> | undefined;
function soon() {
  clearTimeout(timer);
  // While reading, just send; pulling happens on open and on coming back.
  timer = setTimeout(() => void syncNow({ sendOnly: true }), DEBOUNCE_MS);
}

/**
 * Starts syncing in the background: queues every change, and syncs on open,
 * shortly after changes, and when the reader switches away. Returns a stop
 * function. Does nothing when accounts are off.
 */
export function startSync(): () => void {
  if (!accountsEnabled) return () => {};
  const stopHook = setChangeHook((prev, next) => {
    // Queue only for a device that belongs to an account, and not the linking itself.
    if (!next.syncedUser || prev.syncedUser !== next.syncedUser) return;
    const o = getOutbox();
    const after = diffState(prev, next, o);
    if (after === o) return;
    setOutbox(after);
    if (linkedSession()) soon();
  });
  const unsubscribe = subscribe(() => {});
  let lastUser: string | undefined;
  const onAccount = () => {
    const id = account.session?.user.id;
    if (id && id !== lastUser) void syncNow(); // on open, and right after signing in
    lastUser = id;
  };
  listeners.add(onAccount);
  onAccount();
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      void syncNow({ sendOnly: true });
    } else if (Date.now() - lastRun > 60_000) void syncNow();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  return () => {
    stopHook();
    unsubscribe();
    listeners.delete(onAccount);
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
  };
}

// ---------------------------------------------------------------- sign-in

export type CodeError = "not-invited" | "too-soon" | "bad-code" | "unreachable";

function codeError(e: { code?: string; status?: number; message?: string }): CodeError {
  const m = `${e.code ?? ""} ${e.message ?? ""}`.toLowerCase();
  if (m.includes("signup") || m.includes("otp_disabled") || m.includes("user_not_found")) return "not-invited";
  if (e.status === 429 || m.includes("rate") || m.includes("security purposes")) return "too-soon";
  if (m.includes("expired") || m.includes("invalid") || m.includes("token")) return "bad-code";
  return "unreachable";
}

/** Emails a sign-in code, only to people Andrew has added (no new accounts). */
export async function requestCode(email: string): Promise<CodeError | null> {
  const p = supabase();
  if (!p) return "unreachable";
  try {
    const sb = await p;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    return error ? codeError(error) : null;
  } catch {
    return "unreachable";
  }
}

export async function verifyCode(email: string, token: string): Promise<{ session: Session } | { error: CodeError }> {
  const p = supabase();
  if (!p) return { error: "unreachable" };
  try {
    const sb = await p;
    const { data, error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    if (error || !data.session) return { error: error ? codeError(error) : "bad-code" };
    setAccount({ session: data.session });
    return { session: data.session };
  } catch {
    return { error: "unreachable" };
  }
}

/** Signs out on this device only. History stays on this device. */
export async function signOut() {
  const p = supabase();
  if (!p) return;
  await (await p).auth.signOut({ scope: "local" }).catch(() => {});
  setAccount({ session: null, status: "idle" });
}

/**
 * Deletes the person's saved history, collection and feed position, from
 * the account and from this device, then signs out. Their other devices
 * clear their copies the next time they sync.
 */
export async function deleteMyData(): Promise<boolean> {
  const p = supabase();
  if (!p) return false;
  try {
    const sb = await p;
    const { error } = await sb.rpc("clear_my_data");
    if (error) return false;
  } catch {
    return false;
  }
  setOutbox(emptyOutbox());
  applyRemoteState(forget);
  await signOut();
  return true;
}
