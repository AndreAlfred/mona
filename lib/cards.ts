/** Turns curated and archive records into one presentational shape. */
import type { Artist, ClaimSource, Passage, Tag, Work } from "./schema";
import type { ArchiveWork, ArtistContext, CardImage, Catalog } from "./types";
import { slugify } from "./util";

export type ResearchSubject = { type: "work" | "artist" | "tag"; key: string; label: string };

export type CardModel = {
  key: string; // route path: "w/<id>" | "a/<key>"
  curated: boolean;
  title: string;
  date: string;
  medium?: string;
  dimensions?: string;
  image: CardImage;
  museum: { name: string; url: string };
  artist: { key: string; name: string; href: string; line?: string };
  phase?: { label: string; source?: ClaimSource; ai?: boolean };
  sections: { id: string; heading: string; passages: Passage[] }[];
  tags: { id: string; name: string; href: string; highlight?: Passage[]; source?: ClaimSource; ai?: boolean }[];
  peers: { name: string; href?: string }[];
  movements: { name: string; href?: string }[];
  research?: ResearchSubject;
};

const lifeLine = (a: Pick<Artist, "nationality" | "born" | "died" | "active">) =>
  [a.nationality, a.born && `${a.born}–${a.died ?? ""}`, a.active && `active ${a.active}`].filter(Boolean).join(" · ");

export function curatedCard(w: Work, artist: Artist | undefined, catalog: Catalog): CardModel {
  const tagName = (id: string) => catalog.tags[id]?.name ?? id.replace(/-/g, " ");
  return {
    key: `w/${w.id}`,
    curated: true,
    title: w.title,
    date: w.date,
    medium: w.medium,
    dimensions: w.dimensions,
    image: w.image,
    museum: w.museum,
    artist: {
      key: w.artist,
      name: artist?.name ?? catalog.artists[w.artist]?.name ?? w.artist,
      href: `/artist/${w.artist}`,
      line: artist ? lifeLine(artist) : undefined,
    },
    phase: w.phase,
    sections: [
      { id: "work", heading: "In their work", passages: w.sections.work },
      { id: "moment", heading: "In its moment", passages: w.sections.moment },
      { id: "matters", heading: "Why it matters", passages: w.sections.matters },
    ].filter((s) => s.passages.length),
    tags: w.tags.map((t) => ({ id: t.id, name: tagName(t.id), href: `/tag/${t.id}`, highlight: t.highlight, source: t.source, ai: t.ai })),
    peers: (artist?.peers ?? []).map((p) => ({ name: p.name, href: `/artist/${p.id}` })),
    movements: (artist?.movements ?? []).map((m) => ({ name: tagName(m.id), href: `/tag/${m.id}` })),
  };
}

export function archiveCard(
  w: ArchiveWork,
  ctx: ArtistContext | undefined,
  artistKey: string,
  opts: { index?: number; knownArtists?: Map<string, string>; tags?: Record<string, Tag> } = {},
): CardModel {
  const i = opts.index ?? 0;
  const sections: CardModel["sections"] = [];
  if (w.museumText) sections.push({ id: "museum", heading: "From the museum", passages: [w.museumText] });
  if (ctx?.quotes.length) {
    sections.push({ id: "words", heading: "In the artist’s words", passages: [ctx.quotes[i % ctx.quotes.length]] });
  }
  if (ctx?.summary) sections.push({ id: "about", heading: "About the artist", passages: [ctx.summary] });
  const link = (name: string) => {
    const k = opts.knownArtists?.get(name.toLowerCase());
    return { name, href: k ? `/artist/${k}` : undefined };
  };
  return {
    key: `a/${w.key}`,
    curated: false,
    title: w.title,
    date: w.date,
    medium: w.medium,
    dimensions: w.dimensions,
    image: w.image,
    museum: w.museum,
    artist: { key: artistKey, name: w.artistName, href: `/artist/${artistKey}`, line: w.artistLine },
    sections,
    tags: w.tags.map((t) => ({
      id: t.id,
      name: opts.tags?.[t.id]?.name ?? t.name,
      href: `/tag/${t.id}?term=${encodeURIComponent(t.name)}`,
    })),
    peers: (ctx?.influences ?? []).map(link),
    movements: (ctx?.movements ?? []).map((m) => {
      const id = slugify(m);
      return { name: m, href: opts.tags?.[id] ? `/tag/${id}` : `/tag/${id}?term=${encodeURIComponent(m)}` };
    }),
    research: { type: "work", key: w.key, label: "this painting" },
  };
}
