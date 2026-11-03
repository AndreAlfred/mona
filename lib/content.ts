/** Filesystem loaders for content/ (scripts and build only, never the browser). */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Artist, Tag, Work, type Passage, type QuotePassage } from "./schema";
import type { ArchiveArtist } from "./types";

export const CONTENT = join(process.cwd(), "content");

function readDir(dir: string) {
  const full = join(CONTENT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: join(full, f), data: JSON.parse(readFileSync(join(full, f), "utf8")) }));
}

export type Loaded<T> = { file: string; value: T };
export type LoadErrors = { file: string; message: string }[];

function parseAll<T>(dir: string, schema: { safeParse: (v: unknown) => any }, errors: LoadErrors) {
  const out: Loaded<T>[] = [];
  for (const { file, data } of readDir(dir)) {
    const r = schema.safeParse(data);
    if (r.success) out.push({ file, value: r.data });
    else
      errors.push({
        file,
        message: r.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
  }
  return out;
}

export function loadContent() {
  const errors: LoadErrors = [];
  const artists = parseAll<Artist>("artists", Artist, errors);
  const works = parseAll<Work>("works", Work, errors);
  const tags = parseAll<Tag>("tags", Tag, errors);
  const archive: ArchiveArtist[] = existsSync(join(CONTENT, "archive-artists.json"))
    ? JSON.parse(readFileSync(join(CONTENT, "archive-artists.json"), "utf8"))
    : [];
  return { artists, works, tags, archive, errors };
}

/** Every passage in a record, with a human-readable location for reports. */
export function passagesOf(kind: "artist" | "work" | "tag", v: any): { where: string; p: Passage }[] {
  const out: { where: string; p: Passage }[] = [];
  const add = (where: string, list?: Passage[]) => list?.forEach((p, i) => out.push({ where: `${where}[${i}]`, p }));
  if (kind === "artist") add("bio", v.bio);
  if (kind === "tag") add("summary", v.summary);
  if (kind === "work") {
    add("sections.work", v.sections.work);
    add("sections.moment", v.sections.moment);
    add("sections.matters", v.sections.matters);
    v.tags.forEach((t: any) => add(`tags.${t.id}.highlight`, t.highlight));
  }
  return out;
}

export const isQuote = (p: Passage): p is QuotePassage => p.kind === "quote";
