"use client";
/** Memoised browser-side data access. Static JSON for curated content, API routes for the archive. */
import type { Artist, Work } from "./schema";
import type { ArchiveArtist, ArchiveWork, ArtistContext, Catalog } from "./types";
import { artistUniverse, type ArtistRef } from "./feed";

const memo = new Map<string, Promise<any>>();
function get<T>(url: string, init?: RequestInit): Promise<T> {
  if (!memo.has(url)) {
    memo.set(
      url,
      fetch(url, init).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        return r.json();
      }),
    );
    memo.get(url)!.catch(() => memo.delete(url));
  }
  return memo.get(url)!;
}

export const getCatalog = () => get<Catalog>("/data/catalog.json");
export const getArchiveIndex = () => get<ArchiveArtist[]>("/data/archive-artists.json");
export const getWork = (id: string) => get<Work>(`/data/works/${id}.json`);
export const getArtist = (id: string) => get<Artist>(`/data/artists/${id}.json`).catch(() => undefined);

export async function getUniverse(): Promise<ArtistRef[]> {
  const [c, a] = await Promise.all([getCatalog(), getArchiveIndex().catch(() => [])]);
  return artistUniverse(c, a);
}

export async function findArtist(key: string): Promise<ArtistRef | undefined> {
  return (await getUniverse()).find((a) => a.key === key);
}

export function getArchiveWorks(a: Pick<ArtistRef, "aic" | "cma">): Promise<ArchiveWork[]> {
  if (!a.aic && !a.cma?.length) return Promise.resolve([]);
  const q = new URLSearchParams();
  if (a.aic) q.set("aic", String(a.aic));
  if (a.cma?.length) q.set("cma", a.cma.join(","));
  return get<ArchiveWork[]>(`/api/archive/artist-works?${q}`).catch(() => []);
}

export const getArchiveWork = (key: string) => get<ArchiveWork>(`/api/archive/work/${key}`);

export const getArtistContext = (name: string) =>
  get<ArtistContext>(`/api/archive/artist-context?name=${encodeURIComponent(name)}`).catch(
    (): ArtistContext => ({ quotes: [], movements: [], influences: [] }),
  );

export const getTagWorks = (term: string) =>
  get<ArchiveWork[]>(`/api/archive/tag-works?term=${encodeURIComponent(term)}`).catch(() => []);

/** Fresh (uncached) catalog, used to notice when a research request has landed. */
export async function freshCatalog(): Promise<Catalog> {
  const c = await fetch(`/data/catalog.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json());
  memo.set("/data/catalog.json", Promise.resolve(c));
  return c;
}

export async function knownArtistNames(): Promise<Map<string, string>> {
  const u = await getUniverse();
  return new Map(u.map((a) => [a.name.toLowerCase(), a.key]));
}
