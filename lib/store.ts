"use client";
/**
 * Everything personal lives on this device: history, collection, the feed's
 * random seed, visited artists, the research passphrase. The device is
 * always the working copy; signing in to an account (lib/sync.ts) keeps a
 * copy on the server alongside it and merges in other devices' changes.
 */
import { useSyncExternalStore } from "react";

export type Entry = {
  /** Route path of the card: "w/<id>" (curated) or "a/<aic|cma>-<n>" (archive). */
  key: string;
  title: string;
  artist: string;
  date?: string;
  thumb: string;
  at: number;
};

export type DeviceState = {
  v: 1;
  seed: number;
  history: Entry[];
  collection: Entry[];
  visitedArtists: string[];
  lastPeriod?: string;
  /** The artist run in progress, so reopening Mona picks up where you were. */
  current?: { artist: string; shown: number };
  passphrase?: string;
  /** subject key ("work:aic-123" | "artist:<id>" | "tag:<id>") -> GitHub issue number */
  requests: Record<string, number>;
  /** What each request was for, so the Requests page can list it. */
  requestMeta?: Record<string, RequestMeta>;
  /** Finished requests the reader has already looked at (no dot for these). */
  seenDone?: string[];
  /** When `current` or `lastPeriod` last changed here, so the most recently used device's position wins. */
  positionAt?: number;
  /** The account (Supabase user id) this device's data belongs to. Kept after signing out. */
  syncedUser?: string;
  /** Server time of the newest row pulled from each table: the next pull asks for rows after these. */
  lastPull?: { seen?: string; collected?: string; feed?: string };
  /** When this device last finished a sync with the account. */
  syncedAt?: number;
};

/** Fields that describe this device's link to an account, never copied between devices. */
const LINK_FIELDS = ["syncedUser", "lastPull", "syncedAt", "positionAt"] as const;

export type RequestMeta = { title: string; href: string; thumb?: string; at: number };

const KEY = "mona:v1";
const listeners = new Set<() => void>();
let cache: DeviceState | null = null;

function fresh(): DeviceState {
  return {
    v: 1,
    seed: Math.floor(Math.random() * 2 ** 31),
    history: [],
    collection: [],
    visitedArtists: [],
    requests: {},
  };
}

const SERVER_STATE = fresh();

export function getState(): DeviceState {
  if (typeof window === "undefined") return SERVER_STATE;
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...fresh(), ...JSON.parse(raw) } : fresh();
  } catch {
    cache = fresh();
  }
  if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(cache));
  return cache!;
}

type ChangeHook = (prev: DeviceState, next: DeviceState) => void;
let changeHook: ChangeHook | null = null;

/** Lets sync see every change, whichever function made it. One hook; returns a function that removes it. */
export function setChangeHook(fn: ChangeHook) {
  changeHook = fn;
  return () => {
    if (changeHook === fn) changeHook = null;
  };
}

function write(next: DeviceState) {
  cache = next;
  localStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((l) => l());
}

export function update(fn: (s: DeviceState) => DeviceState) {
  const prev = getState();
  let next = fn(prev);
  if (next === prev) return;
  if (next.current?.artist !== prev.current?.artist || next.current?.shown !== prev.current?.shown || next.lastPeriod !== prev.lastPeriod) {
    next = { ...next, positionAt: Date.now() };
  }
  write(next);
  changeHook?.(prev, next);
}

/** For changes that came from the account: saved and shown, but not queued to be sent back. */
export function applyRemoteState(fn: (s: DeviceState) => DeviceState) {
  const prev = getState();
  const next = fn(prev);
  if (next !== prev) write(next);
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDevice<T>(select: (s: DeviceState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(getState()),
    () => select(SERVER_STATE),
  );
}

export function recordSeen(e: Omit<Entry, "at">) {
  update((s) =>
    s.history.some((h) => h.key === e.key)
      ? s
      : { ...s, history: [{ ...e, at: Date.now() }, ...s.history].slice(0, 5000) },
  );
}

export function toggleCollected(e: Omit<Entry, "at">) {
  update((s) => ({
    ...s,
    collection: s.collection.some((c) => c.key === e.key)
      ? s.collection.filter((c) => c.key !== e.key)
      : [{ ...e, at: Date.now() }, ...s.collection],
  }));
}

export function markArtistVisited(key: string, period?: string) {
  update((s) => ({
    ...s,
    visitedArtists: s.visitedArtists.includes(key) ? s.visitedArtists : [...s.visitedArtists, key],
    lastPeriod: period ?? s.lastPeriod,
  }));
}

export function setCurrent(current: DeviceState["current"]) {
  update((s) => ({ ...s, current }));
}

export function exportState() {
  return JSON.stringify(getState(), null, 2);
}

export function importState(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.v !== 1 || !Array.isArray(parsed.history)) throw new Error("Not a Mona export");
  for (const f of LINK_FIELDS) delete parsed[f];
  update((s) => ({
    ...s,
    ...parsed,
    // Merge rather than replace lists, so importing never loses anything.
    history: dedupe([...s.history, ...parsed.history]).slice(0, 5000),
    collection: dedupe([...s.collection, ...(parsed.collection ?? [])]),
    visitedArtists: [...new Set([...s.visitedArtists, ...(parsed.visitedArtists ?? [])])],
  }));
}

function dedupe(list: Entry[]) {
  const seen = new Map<string, Entry>();
  for (const e of list) if (!seen.has(e.key) || seen.get(e.key)!.at > e.at) seen.set(e.key, e);
  return [...seen.values()].sort((a, b) => b.at - a.at);
}

export function recordRequest(id: string, issue: number, meta: RequestMeta, passphrase?: string) {
  update((s) => ({
    ...s,
    passphrase: passphrase ?? s.passphrase,
    requests: { ...s.requests, [id]: issue },
    requestMeta: { ...(s.requestMeta ?? {}), [id]: meta },
    seenDone: (s.seenDone ?? []).filter((x) => x !== `${id}#${issue}`),
  }));
}

export function markRequestsSeen(keys: string[]) {
  update((s) => ({ ...s, seenDone: [...new Set([...(s.seenDone ?? []), ...keys])] }));
}

/** Where a request's results live, for requests made before metadata was stored. */
export function requestHref(id: string) {
  const [type, key] = id.split(":");
  return type === "work" ? `/a/${key}` : type === "artist" ? `/artist/${key}` : `/tag/${key}`;
}
