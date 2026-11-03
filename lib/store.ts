"use client";
/**
 * Everything personal lives on this device: history, collection, the feed's
 * random seed, visited artists, the research passphrase. No accounts.
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
};

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

export function update(fn: (s: DeviceState) => DeviceState) {
  cache = fn(getState());
  localStorage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((l) => l());
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
  update((s) => ({
    ...s,
    ...parsed,
    // Merge rather than replace lists, so importing never loses anything.
    history: dedupe([...s.history, ...parsed.history]),
    collection: dedupe([...s.collection, ...parsed.collection]),
    visitedArtists: [...new Set([...s.visitedArtists, ...parsed.visitedArtists])],
  }));
}

function dedupe(list: Entry[]) {
  const seen = new Map<string, Entry>();
  for (const e of list) if (!seen.has(e.key) || seen.get(e.key)!.at > e.at) seen.set(e.key, e);
  return [...seen.values()].sort((a, b) => b.at - a.at);
}
