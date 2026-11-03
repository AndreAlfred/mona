import type { QuotePassage, Work, Artist, Tag } from "./schema";

export type CardImage = {
  url: string;
  /** Sharper version for wide screens and the full-image link. */
  large?: string;
  width?: number;
  height?: number;
  license: string;
  credit: string;
};

/** A work built live from a museum's open data. No AI anywhere in it. */
export type ArchiveWork = {
  key: string; // "aic-80607" | "cma-94979"
  source: "aic" | "cma";
  sourceId: number;
  title: string;
  date: string;
  year?: number;
  medium?: string;
  dimensions?: string;
  artistName: string;
  artistLine?: string; // museum's display line, e.g. "Dutch, 1606–1669"
  museum: { name: string; url: string };
  image: CardImage;
  museumText?: QuotePassage;
  tags: { id: string; name: string }[];
};

/** Live context about an artist from Wikipedia, Wikiquote and Wikidata. */
export type ArtistContext = {
  wikipediaTitle?: string;
  summary?: QuotePassage;
  quotes: QuotePassage[];
  movements: string[];
  influences: string[];
};

export type ArchiveArtist = {
  id: string;
  name: string;
  born?: number;
  died?: number;
  nationality?: string;
  period: string;
  aic?: number;
  cma?: number[];
  count: number;
};

/** What the client downloads once: everything needed to plan a feed. */
export type Catalog = {
  generatedAt: string;
  artists: Record<string, Omit<Artist, "bio"> & { workIds: string[] }>;
  tags: Record<string, Tag>;
  works: Record<string, Pick<Work, "id" | "artist" | "title" | "date" | "year" | "archive"> & { tags: string[]; thumb: string }>;
};

/** A unit in the feed: either a curated work id or an archive work. */
export type FeedItem =
  | { type: "curated"; key: string; id: string; artistKey: string }
  | { type: "archive"; key: string; work: ArchiveWork; artistKey: string };
