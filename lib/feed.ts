/**
 * The feed goes deep before it goes wide: up to RUN_LENGTH works by one
 * artist, then a deliberate choice to keep going or move on. Pure functions
 * here; the React side lives in components/Feed.tsx.
 */
import type { ArchiveArtist, Catalog } from "./types";
import { normName } from "./util";

export const RUN_LENGTH = 10;

export type ArtistRef = {
  key: string;
  name: string;
  period: string;
  curated: boolean;
  born?: number;
  died?: number;
  nationality?: string;
  aic?: number;
  cma?: number[];
  weight: number;
};

/** One list of artists: curated ones (with archive ids merged in) then archive-only ones. */
export function artistUniverse(catalog: Catalog, archive: ArchiveArtist[]): ArtistRef[] {
  const curated: ArtistRef[] = Object.values(catalog.artists)
    .filter((a) => a.workIds.length > 0)
    .map((a) => ({
      key: a.id,
      name: a.name,
      period: a.period,
      curated: true,
      born: a.born,
      died: a.died,
      nationality: a.nationality,
      aic: a.archive?.aic,
      cma: a.archive?.cma,
      weight: 1,
    }));
  const byName = new Map(curated.map((a) => [normName(a.name), a]));
  const byAic = new Map(curated.filter((a) => a.aic).map((a) => [a.aic!, a]));
  const byCma = new Map(curated.flatMap((a) => (a.cma ?? []).map((c) => [c, a] as const)));
  const rest: ArtistRef[] = [];
  for (const e of archive) {
    // AIC images can't be embedded and Commons covers few of them, so the
    // feed draws archive artists from those with Cleveland works.
    if (!e.cma?.length && !byName.has(normName(e.name)) && !(e.aic && byAic.has(e.aic))) continue;
    const twin =
      (e.aic && byAic.get(e.aic)) || e.cma?.map((c) => byCma.get(c)).find(Boolean) || byName.get(normName(e.name));
    if (twin) {
      // Let the curated artist continue into its archive works.
      twin.aic ??= e.aic;
      twin.cma = [...new Set([...(twin.cma ?? []), ...(e.cma ?? [])])];
      continue;
    }
    rest.push({ key: e.id, name: e.name, period: e.period, curated: false, born: e.born, died: e.died, nationality: e.nationality, aic: e.aic, cma: e.cma, weight: Math.sqrt(Math.min(e.count, 60)) });
  }
  return [...curated, ...rest];
}

/** Small, fast, seedable PRNG so each device has its own reproducible path. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T extends { weight: number }>(list: T[], r: () => number): T {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let n = r() * total;
  for (const x of list) if ((n -= x.weight) <= 0) return x;
  return list[list.length - 1];
}

/**
 * Next artist: unseen curated artists first, then the archive. Prefer a
 * different period from the last one so consecutive artists contrast.
 */
export function pickNextArtist(
  universe: ArtistRef[],
  visited: string[],
  lastPeriod: string | undefined,
  r: () => number,
): ArtistRef | null {
  if (!universe.length) return null;
  const seen = new Set(visited);
  const pools = [universe.filter((a) => a.curated && !seen.has(a.key)), universe.filter((a) => !a.curated && !seen.has(a.key))];
  // Everyone visited (a long way off): start over, avoiding the most recent few.
  const recent = new Set(visited.slice(-5));
  pools.push(universe.filter((a) => !recent.has(a.key)), universe);
  for (const pool of pools) {
    if (!pool.length) continue;
    const contrast = pool.filter((a) => a.period !== lastPeriod);
    return weightedPick(contrast.length ? contrast : pool, r);
  }
  return null;
}

/** Interleave nothing: curated works in career order first, then archive works not already curated. */
export function orderWorks<C extends { key: string; archive?: { aic?: number; cma?: number } }, A extends { key: string }>(
  curated: C[],
  archive: A[],
  seen: Set<string>,
): (C | A)[] {
  const curatedArchiveKeys = new Set(
    curated.flatMap((c) => [c.archive?.aic && `a/aic-${c.archive.aic}`, c.archive?.cma && `a/cma-${c.archive.cma}`].filter(Boolean) as string[]),
  );
  return [...curated, ...archive.filter((a) => !curatedArchiveKeys.has(a.key))].filter((x) => !seen.has(x.key));
}

const normTitle = (t: string) => normName(t);

/**
 * Drop records that would show the same picture twice:
 * - a series record whose plates are also listed ("The Passion" when
 *   "The Passion: The Last Supper" is there; museums illustrate the series
 *   with its first plate), and
 * - repeated specific titles (two impressions of "The Passion: The
 *   Flagellation"). Short generic titles like "Self-Portrait" may repeat.
 */
export function dedupeWorks<T extends { key: string; title: string }>(list: T[]): T[] {
  const lower = list.map((x) => x.title.trim().toLowerCase());
  const keys = new Set<string>();
  const titles = new Set<string>();
  return list.filter((x, i) => {
    if (lower.some((t, j) => j !== i && t.startsWith(`${lower[i]}:`))) return false;
    if (keys.has(x.key)) return false;
    keys.add(x.key);
    const specific = x.title.includes(":") || x.title.split(/\s+/).length >= 6;
    const t = normTitle(x.title);
    if (specific && titles.has(t)) return false;
    titles.add(t);
    return true;
  });
}
