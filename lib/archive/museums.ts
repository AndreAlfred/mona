import type { ArchiveWork } from "../types";
import { slugify, stripHtml, today, UA } from "../util";
import { commonsImagesForAic } from "./commons";

/**
 * AIC's image server won't serve images embedded in other sites, so AIC works
 * use the Wikimedia Commons photograph of the same object. Works without one
 * are dropped rather than shown blank.
 */
async function withCommonsImages(works: ArchiveWork[]): Promise<ArchiveWork[]> {
  const images = await commonsImagesForAic(works.filter((w) => w.source === "aic").map((w) => w.sourceId)).catch(
    () => new Map(),
  );
  return works.flatMap((w) => {
    if (w.source !== "aic") return [w];
    const image = images.get(w.sourceId);
    return image ? [{ ...w, image }] : [];
  });
}

const AIC_FIELDS = [
  "id",
  "title",
  "artist_title",
  "artist_display",
  "date_display",
  "date_start",
  "medium_display",
  "dimensions",
  "image_id",
  "is_public_domain",
  "description",
  "style_titles",
  "technique_titles",
  "material_titles",
  "thumbnail",
  "credit_line",
];

async function json(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "AIC-User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const GENERIC_TAG =
  /^(\d+(st|nd|rd|th) century|[a-z]+teenth century|[a-z]+ century|painting|paintings|painting techniques|paint|drawing|drawings|print|prints|works on paper|european painting|art|arts|fine arts?|visual arts?|object|objects)$/i;

function tagList(...groups: (string[] | undefined)[]) {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const name of groups.flat()) {
    if (!name) continue;
    const clean = name.replace(/\s*\(.*\)$/, "").trim();
    if (GENERIC_TAG.test(clean)) continue;
    const id = slugify(clean);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: clean.toLowerCase() });
  }
  return out.slice(0, 6);
}

export function aicToWork(w: any): ArchiveWork | null {
  if (!w?.image_id || !w.is_public_domain) return null;
  const width = w.thumbnail?.width as number | undefined;
  const height = w.thumbnail?.height as number | undefined;
  const pageUrl = `https://www.artic.edu/artworks/${w.id}`;
  const text = w.description ? stripHtml(w.description) : "";
  return {
    key: `aic-${w.id}`,
    source: "aic",
    sourceId: w.id,
    title: w.title,
    date: w.date_display ?? "",
    year: w.date_start ?? undefined,
    medium: w.medium_display ?? undefined,
    dimensions: w.dimensions ?? undefined,
    artistName: w.artist_title ?? "Unknown artist",
    artistLine: w.artist_display?.split("\n")[1],
    museum: { name: "Art Institute of Chicago", url: pageUrl },
    image: {
      url: `https://www.artic.edu/iiif/2/${w.image_id}/full/843,/0/default.jpg`,
      large: `https://www.artic.edu/iiif/2/${w.image_id}/full/1686,/0/default.jpg`,
      width,
      height,
      license: "CC0",
      credit: `Art Institute of Chicago${w.credit_line ? `, ${w.credit_line}` : ""}`,
    },
    museumText: text
      ? {
          kind: "quote",
          text,
          source: {
            author: "Art Institute of Chicago",
            title: `Collection description: ${w.title}`,
            publisher: "Art Institute of Chicago",
            url: pageUrl,
            readAt: `https://api.artic.edu/api/v1/artworks/${w.id}?fields=id,title,description`,
            accessed: today(),
            tier: 4,
            license: "CC BY 4.0",
          },
        }
      : undefined,
    tags: tagList(w.style_titles, w.technique_titles, w.material_titles),
  };
}

export function cmaToWork(w: any): ArchiveWork | null {
  // "web" is ~750px and light; "print" is several MB, so only link to it.
  const img = w?.images?.web ?? w?.images?.print;
  if (!img?.url || w.share_license_status !== "CC0") return null;
  const creator = (w.creators ?? []).find((c: any) => c.role === "artist") ?? w.creators?.[0];
  const name = String(creator?.description ?? "Unknown artist").replace(/\s*\(.*$/, "");
  const line = /\((.*)\)/.exec(creator?.description ?? "")?.[1];
  const text = [w.description, w.wall_description].filter(Boolean).map(stripHtml)[0] ?? "";
  return {
    key: `cma-${w.id}`,
    source: "cma",
    sourceId: w.id,
    title: w.title,
    date: w.creation_date ?? "",
    year: w.creation_date_earliest ?? undefined,
    medium: w.technique ?? undefined,
    dimensions: w.measurements?.split(";")[0] ?? undefined,
    artistName: name,
    artistLine: line,
    museum: { name: "Cleveland Museum of Art", url: w.url },
    image: {
      url: img.url,
      large: w.images?.print?.url,
      width: Number(img.width) || undefined,
      height: Number(img.height) || undefined,
      license: "CC0",
      credit: `Cleveland Museum of Art${w.creditline ? `, ${w.creditline}` : ""}`,
    },
    museumText: text
      ? {
          kind: "quote",
          text,
          source: {
            author: "Cleveland Museum of Art",
            title: `Collection description: ${w.title}`,
            publisher: "Cleveland Museum of Art",
            url: w.url,
            readAt: `https://openaccess-api.clevelandart.org/api/artworks/${w.id}`,
            accessed: today(),
            tier: 4,
            license: "CC0",
          },
        }
      : undefined,
    tags: tagList([w.technique?.split(/,| and /)[0]].filter(Boolean), w.type ? [w.type] : []),
  };
}

export async function aicWorksByArtist(artistId: number, limit = 100): Promise<ArchiveWork[]> {
  const params = {
    query: {
      bool: {
        must: [
          { term: { artist_id: artistId } },
          { term: { is_public_domain: true } },
          { exists: { field: "image_id" } },
        ],
      },
    },
    sort: [{ is_boosted: "desc" }, { has_not_been_viewed_much: "asc" }],
    fields: AIC_FIELDS,
    limit,
  };
  const res = await json(
    `https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`,
  );
  return withCommonsImages(res.data.map(aicToWork).filter(Boolean));
}

export async function cmaWorksByCreator(creatorId: number, limit = 40): Promise<ArchiveWork[]> {
  const creator = await json(`https://openaccess-api.clevelandart.org/api/creators/${creatorId}`);
  const ids: number[] = (creator.data?.artworks ?? []).map((a: any) => a.id).slice(0, 120);
  const works: ArchiveWork[] = [];
  // The creator endpoint lists ids only; fetch in small parallel batches.
  for (let i = 0; i < ids.length && works.length < limit; i += 12) {
    const batch = await Promise.all(
      ids.slice(i, i + 12).map((id) =>
        json(`https://openaccess-api.clevelandart.org/api/artworks/${id}`)
          .then((r) => cmaToWork(r.data))
          .catch(() => null),
      ),
    );
    works.push(...(batch.filter(Boolean) as ArchiveWork[]));
  }
  return works.slice(0, limit);
}

export async function archiveWork(key: string): Promise<ArchiveWork | null> {
  const m = /^(aic|cma)-(\d+)$/.exec(key);
  if (!m) return null;
  const id = Number(m[2]);
  if (m[1] === "aic") {
    const r = await json(`https://api.artic.edu/api/v1/artworks/${id}?fields=${AIC_FIELDS.join(",")}`);
    const w = aicToWork(r.data);
    return w ? ((await withCommonsImages([w]))[0] ?? null) : null;
  }
  const r = await json(`https://openaccess-api.clevelandart.org/api/artworks/${id}`);
  return cmaToWork(r.data);
}

/** AIC works sharing a style/technique/material term, for tag feeds. */
export async function aicWorksByTerm(term: string, limit = 80): Promise<ArchiveWork[]> {
  const params = {
    q: term,
    query: {
      bool: {
        must: [
          { term: { is_public_domain: true } },
          { exists: { field: "image_id" } },
          { range: { date_end: { lte: 1930 } } },
        ],
      },
    },
    fields: AIC_FIELDS,
    limit,
  };
  const res = await json(
    `https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`,
  );
  return withCommonsImages(res.data.map(aicToWork).filter(Boolean));
}
