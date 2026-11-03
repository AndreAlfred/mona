import { z } from "zod";

/** Source hierarchy, highest trust first. See docs/superpowers/specs. */
export const TIERS = {
  1: "Artist",
  2: "Scholar",
  3: "Critic",
  4: "Museum",
  5: "Wikipedia",
  6: "Web",
  7: "Social",
} as const;
export type Tier = keyof typeof TIERS;

export const QUOTE_WORD_LIMIT = 75;

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case id");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Links render as <a href>, so only web URLs (never javascript: or data:). */
const webUrl = () => z.url({ protocol: /^https?$/ });

export const Source = z.object({
  author: z.string().min(1),
  title: z.string().min(1), // book, article, letter, page title
  publisher: z.string().optional(), // publisher, journal, museum, site
  year: z.string().optional(),
  page: z.string().optional(),
  /** Canonical link to the cited work, if different from where it was read. */
  url: webUrl().optional(),
  /** Where the agent actually read this text. Verified verbatim at merge. */
  readAt: webUrl(),
  accessed: isoDate,
  tier: z.number().int().min(1).max(7),
  license: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const QuotePassage = z.object({
  kind: z.literal("quote"),
  text: z.string().min(1),
  /** Optional one-line framing in Mona's voice, e.g. "Writing to Theo in 1888:". */
  lead: z.string().optional(),
  source: Source,
});
export const AiPassage = z.object({
  kind: z.literal("ai"),
  text: z.string().min(1),
});
export const Passage = z.discriminatedUnion("kind", [QuotePassage, AiPassage]);
export type Passage = z.infer<typeof Passage>;
export type QuotePassage = z.infer<typeof QuotePassage>;

/** A structured record backing a factual claim (museum record, Wikidata, a page). */
export const ClaimSource = z.object({ label: z.string(), url: webUrl() });
export type ClaimSource = z.infer<typeof ClaimSource>;

/** A claim is either sourced, or explicitly marked as Mona's (AI) judgement. */
const sourcedOrAi = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, source: ClaimSource.optional(), ai: z.boolean().optional() })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .refine((v: any) => Boolean(v.source) !== Boolean(v.ai), {
      message: "claim needs exactly one of `source` or `ai: true`",
    });

export const PERIODS = [
  { id: "medieval", name: "Medieval", from: -9999, to: 1399 },
  { id: "renaissance", name: "Renaissance", from: 1400, to: 1529 },
  { id: "late-renaissance", name: "Late Renaissance & Mannerism", from: 1530, to: 1599 },
  { id: "baroque", name: "Baroque", from: 1600, to: 1699 },
  { id: "eighteenth-century", name: "Rococo & Enlightenment", from: 1700, to: 1779 },
  { id: "romantic", name: "Neoclassicism & Romanticism", from: 1780, to: 1849 },
  { id: "modern-life", name: "Realism & Impressionism", from: 1850, to: 1889 },
  { id: "fin-de-siecle", name: "Fin de siècle", from: 1890, to: 1930 },
] as const;
export const PeriodId = z.enum(PERIODS.map((p) => p.id) as [string, ...string[]]);
export type PeriodId = (typeof PERIODS)[number]["id"];

export function periodForYear(year: number): PeriodId {
  return (PERIODS.find((p) => year >= p.from && year <= p.to) ?? PERIODS[PERIODS.length - 1]).id;
}

/** Links a curated record to its archive counterpart so the two are deduplicated. */
export const ArchiveRef = z.object({
  aic: z.number().int().optional(),
  cma: z.number().int().optional(),
  /** Wikidata item for works from any other museum. */
  wd: z.string().regex(/^Q\d+$/).optional(),
});

export const Work = z.object({
  id,
  artist: id,
  title: z.string(),
  date: z.string(), // display date, e.g. "c. 1665"
  year: z.number().int(), // sortable
  medium: z.string().optional(),
  dimensions: z.string().optional(),
  museum: z.object({ name: z.string(), url: webUrl(), accession: z.string().optional() }),
  image: z.object({
    url: webUrl(),
    large: webUrl().optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    license: z.string(), // e.g. "CC0", "Public domain"
    credit: z.string(),
  }),
  archive: ArchiveRef.optional(),
  phase: sourcedOrAi({ label: z.string() }).optional(),
  tags: z.array(
    sourcedOrAi({
      id,
      /** Present when the tag is especially significant to this work. */
      highlight: z.array(Passage).optional(),
    }),
  ),
  sections: z.object({
    work: z.array(Passage), // In their work
    moment: z.array(Passage), // In its moment
    matters: z.array(Passage), // Why it matters
  }),
  curated: z.object({ on: isoDate, by: z.string() }),
});
export type Work = z.infer<typeof Work>;

export const Artist = z.object({
  id,
  name: z.string(),
  born: z.number().int().optional(),
  died: z.number().int().optional(),
  active: z.string(), // e.g. "1630s–1669"
  nationality: z.string().optional(),
  period: PeriodId,
  movements: z.array(sourcedOrAi({ id })),
  peers: z.array(sourcedOrAi({ id, name: z.string() })),
  wikidata: z.string().regex(/^Q\d+$/).optional(),
  archive: z
    .object({ aic: z.number().int().optional(), cma: z.array(z.number().int()).optional() })
    .optional(),
  bio: z.array(Passage),
  curated: z.object({ on: isoDate, by: z.string() }),
});
export type Artist = z.infer<typeof Artist>;

export const TagKind = z.enum(["technique", "material", "style", "movement", "subject"]);
export const Tag = z.object({
  id,
  kind: TagKind,
  name: z.string(),
  summary: z.array(Passage),
  /** Search term for finding archive works with this tag (AIC term). */
  archiveTerm: z.string().optional(),
});
export type Tag = z.infer<typeof Tag>;
