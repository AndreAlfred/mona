import { describe, expect, it } from "vitest";
import type { DeviceState, Entry } from "../lib/store";
import {
  applyRemote,
  diffState,
  emptyOutbox,
  HISTORY_CAP,
  isEmpty,
  newestUpdate,
  outboxFor,
  withoutSent,
  type CollectedRow,
  type FeedRow,
  type SeenRow,
} from "../lib/sync-merge";

const T = (iso: string) => Date.parse(iso);
const entry = (key: string, at: string): Entry => ({ key, title: `T ${key}`, artist: "A", thumb: "t.jpg", at: T(at) });
const state = (over: Partial<DeviceState> = {}): DeviceState => ({
  v: 1,
  seed: 7,
  history: [],
  collection: [],
  visitedArtists: [],
  requests: {},
  ...over,
});
const seenRow = (key: string, seen_at: string): SeenRow => ({ key, title: `T ${key}`, artist: "A", date: null, thumb: "t.jpg", seen_at });
const colRow = (key: string, collected_at: string, removed_at: string | null = null): CollectedRow => ({
  key,
  title: `T ${key}`,
  artist: "A",
  date: null,
  thumb: "t.jpg",
  collected_at,
  removed_at,
});
const feedRow = (over: Partial<FeedRow> = {}): FeedRow => ({
  seed: null,
  visited_artists: [],
  last_period: null,
  current: null,
  position_at: null,
  cleared_at: null,
  updated_at: "2026-11-14T12:00:00Z",
  ...over,
});
const none = { seen: [], collected: [], feed: null };

describe("diffState", () => {
  it("queues new history entries, coalesced by work", () => {
    const a = state();
    const b = { ...a, history: [entry("w/1", "2026-11-14T10:00:00Z")] };
    const o = diffState(a, b, emptyOutbox());
    expect(Object.keys(o.seen)).toEqual(["w/1"]);
    expect(o.seen["w/1"].seen_at).toBe("2026-11-14T10:00:00.000Z");
    expect(o.feed).toBe(0);
  });

  it("returns the same outbox when nothing worth sending changed", () => {
    const a = state({ passphrase: "x" });
    const o = emptyOutbox();
    expect(diffState(a, { ...a, passphrase: "y" }, o)).toBe(o);
  });

  it("queues an import that moves a work earlier", () => {
    const a = state({ history: [entry("w/1", "2026-11-14T10:00:00Z")] });
    const b = { ...a, history: [entry("w/1", "2026-11-01T10:00:00Z")] };
    expect(diffState(a, b, emptyOutbox()).seen["w/1"].seen_at).toBe("2026-11-01T10:00:00.000Z");
  });

  it("turns un-collecting into a removal, not a deletion", () => {
    const a = state({ collection: [entry("w/1", "2026-11-14T10:00:00Z")] });
    const o = diffState(a, { ...a, collection: [] }, emptyOutbox(), T("2026-11-14T11:00:00Z"));
    expect(o.collected["w/1"]).toMatchObject({ collected_at: "2026-11-14T10:00:00.000Z", removed_at: "2026-11-14T11:00:00.000Z" });
  });

  it("marks the feed for sending on the per-card shown bump, counting each change", () => {
    const a = state({ current: { artist: "x", shown: 1 } });
    const b = { ...a, current: { artist: "x", shown: 2 } };
    const o1 = diffState(a, b, emptyOutbox());
    const o2 = diffState(b, { ...b, current: { artist: "x", shown: 3 } }, o1);
    expect(o1.feed).toBe(1);
    expect(o2.feed).toBe(2);
  });

  it("puts everything on a device in the first upload", () => {
    const s = state({
      history: [entry("w/1", "2026-11-14T10:00:00Z")],
      collection: [entry("w/2", "2026-11-14T10:00:00Z")],
      visitedArtists: ["x"],
    });
    const o = outboxFor(s);
    expect(Object.keys(o.seen)).toEqual(["w/1"]);
    expect(o.collected["w/2"].removed_at).toBeNull();
    expect(o.feed).toBeGreaterThan(0);
  });
});

describe("withoutSent", () => {
  it("keeps items that changed again while being sent", () => {
    const a = state();
    const o1 = diffState(a, { ...a, history: [entry("w/1", "2026-11-14T10:00:00Z")], visitedArtists: ["x"] }, emptyOutbox());
    const later = { ...o1, seen: { ...o1.seen, "w/2": seenRow("w/2", "2026-11-14T10:01:00Z") }, feed: o1.feed + 1 };
    const left = withoutSent(later, o1);
    expect(Object.keys(left.seen)).toEqual(["w/2"]);
    expect(left.feed).toBe(later.feed);
    expect(isEmpty(withoutSent(o1, o1))).toBe(true);
  });
});

describe("applyRemote", () => {
  it("unions history and keeps the earliest time seen", () => {
    const local = state({ history: [entry("w/1", "2026-11-14T10:00:00Z"), entry("w/2", "2026-11-10T10:00:00Z")] });
    const out = applyRemote(local, { ...none, seen: [seenRow("w/1", "2026-11-09T10:00:00Z"), seenRow("w/2", "2026-11-12T10:00:00Z"), seenRow("w/3", "2026-11-13T10:00:00Z")] }, "x");
    expect(out.history.map((e) => [e.key, new Date(e.at).toISOString().slice(0, 10)])).toEqual([
      ["w/3", "2026-11-13"],
      ["w/2", "2026-11-10"],
      ["w/1", "2026-11-09"],
    ]);
  });

  it("keeps only the most recent entries on the device", () => {
    const rows = Array.from({ length: HISTORY_CAP + 50 }, (_, i) => seenRow(`w/${i}`, new Date(T("2026-01-01T00:00:00Z") + i * 60_000).toISOString()));
    const out = applyRemote(state(), { ...none, seen: rows }, undefined);
    expect(out.history).toHaveLength(HISTORY_CAP);
    expect(out.history[0].key).toBe(`w/${HISTORY_CAP + 49}`);
  });

  it("applies a removal made after the local collect", () => {
    const local = state({ collection: [entry("w/1", "2026-11-10T10:00:00Z")] });
    const out = applyRemote(local, { ...none, collected: [colRow("w/1", "2026-11-10T10:00:00Z", "2026-11-11T10:00:00Z")] }, "x");
    expect(out.collection).toEqual([]);
  });

  it("collect, remove, collect again ends collected", () => {
    const local = state({ collection: [entry("w/1", "2026-11-12T10:00:00Z")] });
    const out = applyRemote(local, { ...none, collected: [colRow("w/1", "2026-11-10T10:00:00Z", "2026-11-11T10:00:00Z")] }, "x");
    expect(out.collection.map((e) => e.key)).toEqual(["w/1"]);
  });

  it("doesn't let an older collect undo a removal still waiting to be sent", () => {
    const pending = diffState(state({ collection: [entry("w/1", "2026-11-10T10:00:00Z")] }), state(), emptyOutbox(), T("2026-11-14T10:00:00Z"));
    const out = applyRemote(state(), { ...none, collected: [colRow("w/1", "2026-11-10T10:00:00Z")] }, "x", pending);
    expect(out.collection).toEqual([]);
    // ...while a newer collect from another device does come in.
    const out2 = applyRemote(state(), { ...none, collected: [colRow("w/1", "2026-11-14T11:00:00Z")] }, "x", pending);
    expect(out2.collection.map((e) => e.key)).toEqual(["w/1"]);
  });

  it("unions visited artists and adopts the account's seed", () => {
    const local = state({ seed: 7, visitedArtists: ["a", "b"] });
    const out = applyRemote(local, { ...none, feed: feedRow({ seed: 99, visited_artists: ["c", "a"] }) }, "x");
    expect(out.visitedArtists).toEqual(["a", "b", "c"]);
    expect(out.seed).toBe(99);
  });

  it("takes the run in progress from whichever device moved most recently", () => {
    const local = state({ current: { artist: "mine", shown: 4 }, positionAt: T("2026-11-14T10:00:00Z") });
    const newer = feedRow({ current: { artist: "theirs", shown: 1 }, position_at: "2026-11-14T11:00:00Z" });
    const older = feedRow({ current: { artist: "theirs", shown: 1 }, position_at: "2026-11-14T09:00:00Z" });
    expect(applyRemote(local, { ...none, feed: newer }, "x").current?.artist).toBe("theirs");
    expect(applyRemote(local, { ...none, feed: older }, "x").current?.artist).toBe("mine");
  });

  it("wipes the device's copy when the account was cleared since the last pull", () => {
    const local = state({ history: [entry("w/1", "2026-11-10T10:00:00Z")], collection: [entry("w/1", "2026-11-10T10:00:00Z")], visitedArtists: ["a"] });
    const cleared = feedRow({ cleared_at: "2026-11-14T12:00:00Z" });
    const out = applyRemote(local, { ...none, feed: cleared, seen: [seenRow("w/9", "2026-11-14T12:30:00Z")] }, "2026-11-14T11:00:00Z");
    expect(out.history.map((e) => e.key)).toEqual(["w/9"]); // only what came after the clear
    expect(out.collection).toEqual([]);
    expect(out.visitedArtists).toEqual([]);
    // Seen it already: no second wipe.
    expect(applyRemote(local, { ...none, feed: cleared }, "2026-11-14T12:00:00Z").history).toHaveLength(1);
    // A device that has never pulled keeps its own data; it's about to upload it.
    expect(applyRemote(local, { ...none, feed: cleared }, undefined).history).toHaveLength(1);
  });

  it("returns the same state when nothing changes", () => {
    const local = state({ history: [entry("w/1", "2026-11-10T10:00:00Z")] });
    expect(applyRemote(local, { ...none, seen: [seenRow("w/1", "2026-11-12T10:00:00Z")] }, "x")).toBe(local);
  });
});

describe("newestUpdate", () => {
  it("moves the cursor to the newest row, never backwards", () => {
    expect(newestUpdate([{ updated_at: "2026-11-14T10:00:00.123456+00:00" }, { updated_at: "2026-11-14T09:00:00+00:00" }], "2026-11-13T00:00:00Z")).toBe(
      "2026-11-14T10:00:00.123456+00:00",
    );
    expect(newestUpdate([], "2026-11-13T00:00:00Z")).toBe("2026-11-13T00:00:00Z");
  });
});
