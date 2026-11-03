import { describe, expect, it } from "vitest";
import { artistUniverse, orderWorks, pickNextArtist, rng } from "../lib/feed";
import type { Catalog, ArchiveArtist } from "../lib/types";

const catalog = {
  generatedAt: "",
  tags: {},
  works: {},
  artists: {
    rembrandt: { id: "rembrandt", name: "Rembrandt van Rijn", period: "baroque", archive: { aic: 1 }, workIds: ["w1"] },
    nobody: { id: "nobody", name: "No Works", period: "baroque", workIds: [] },
  },
} as unknown as Catalog;

const archive: ArchiveArtist[] = [
  { id: "rembrandt-van-rijn", name: "Rembrandt van Rijn", period: "baroque", aic: 1, cma: [9], count: 50 },
  { id: "hokusai", name: "Katsushika Hokusai", period: "romantic", aic: 2, cma: [7], count: 200 },
  { id: "aic-only", name: "Only In Chicago", period: "baroque", aic: 99, count: 50 },
  { id: "durer", name: "Albrecht Dürer", period: "renaissance", cma: [3], count: 100 },
];

describe("artistUniverse", () => {
  const u = artistUniverse(catalog, archive);
  it("puts curated artists first and merges their archive twins", () => {
    expect(u[0].key).toBe("rembrandt");
    expect(u[0].cma).toEqual([9]);
    expect(u.find((a) => a.key === "rembrandt-van-rijn")).toBeUndefined();
  });
  it("skips archive artists with no embeddable (Cleveland) works", () => {
    expect(u.find((a) => a.key === "aic-only")).toBeUndefined();
  });
  it("drops curated artists without works", () => {
    expect(u.find((a) => a.key === "nobody")).toBeUndefined();
  });
});

describe("pickNextArtist", () => {
  const u = artistUniverse(catalog, archive);
  it("prefers unvisited curated artists", () => {
    expect(pickNextArtist(u, [], undefined, rng(1))?.key).toBe("rembrandt");
  });
  it("then archive artists from a different period", () => {
    for (let s = 0; s < 20; s++) {
      const a = pickNextArtist(u, ["rembrandt"], "romantic", rng(s));
      expect(a?.key).toBe("durer");
    }
  });
  it("starts over when everyone has been visited", () => {
    expect(pickNextArtist(u, ["rembrandt", "hokusai", "durer"], undefined, rng(3))).not.toBeNull();
  });
});

describe("orderWorks", () => {
  it("puts curated first, drops archive duplicates of curated works and seen works", () => {
    const curated = [{ key: "w/a", archive: { aic: 10 } }, { key: "w/b" }];
    const arch = [{ key: "a/aic-10" }, { key: "a/aic-11" }, { key: "a/cma-5" }];
    expect(orderWorks(curated, arch, new Set(["a/cma-5"])).map((x) => x.key)).toEqual(["w/a", "w/b", "a/aic-11"]);
  });
});
