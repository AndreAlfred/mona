/**
 * Works from any museum, via Wikidata + Wikimedia Commons. Used to scaffold
 * curated works (`npm run new-work -- wd-Q12345 <artist>`) and to list an
 * artist's public-domain works (`npm run find-works`). Facts come from the
 * work's Wikidata record; the card links to the holding museum's page when
 * Wikidata has one ("described at URL"), else to the Wikidata record.
 */
import type { ArchiveWork } from "../types";
import { commonsFile, commonsImages, sparql, wdJson } from "./commons";

const PUBLIC_DOMAIN = "Q19652";
const CIRCA = "Q5727902";

type Claim = { mainsnak: { datavalue?: { value: any } }; qualifiers?: Record<string, { datavalue?: { value: any } }[]> };
const claims = (e: any, p: string): Claim[] => e?.claims?.[p] ?? [];
const ids = (e: any, p: string) => claims(e, p).map((c) => c.mainsnak.datavalue?.value?.id).filter(Boolean) as string[];
const strings = (e: any, p: string) =>
  claims(e, p).map((c) => c.mainsnak.datavalue?.value).filter((v) => typeof v === "string") as string[];
const year = (t?: string) => (t ? Number(/^[+-]?(\d{1,4})/.exec(t)?.[1]) : undefined);

async function entities(qids: string[]) {
  const out: Record<string, any> = {};
  for (let i = 0; i < qids.length; i += 50) {
    const r = await wdJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en&ids=${qids.slice(i, i + 50).join("|")}`,
    );
    Object.assign(out, r.entities);
  }
  return out;
}
const label = (e: any) => e?.labels?.en?.value as string | undefined;

function quantity(e: any, p: string) {
  const v = claims(e, p)[0]?.mainsnak.datavalue?.value;
  if (!v) return undefined;
  const u = String(v.unit).split("/").pop();
  const unit = u === "Q174728" ? "cm" : u === "Q174789" ? "mm" : u === "Q11573" ? "m" : "";
  return { n: Number(v.amount), unit };
}

/** English title, with the original-language title alongside when it differs. */
function titleOf(work: any) {
  const en = label(work);
  const original = claims(work, "P1476")[0]?.mainsnak.datavalue?.value?.text as string | undefined;
  if (en && original && original.toLowerCase() !== en.toLowerCase() && !/[()]/.test(original + en))
    return `${en} (${original})`;
  return en ?? original ?? "Untitled";
}

const SUPPORTS = /^(canvas|panel|wood|paper|board|cardboard|copper|oak|poplar|vellum|parchment|silk|linen)/i;
/** ["oil paint", "canvas"] -> "oil paint on canvas" */
function mediumOf(materials: string[]) {
  if (!materials.length) return undefined;
  const supports = materials.filter((m) => SUPPORTS.test(m));
  const media = materials.filter((m) => !SUPPORTS.test(m));
  if (media.length && supports.length) return `${media.join(", ")} on ${supports.join(", ")}`;
  return materials.join(", ");
}

export async function wikidataWork(qid: string): Promise<ArchiveWork | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  const work = (await entities([qid]))[qid];
  if (!work) return null;
  const imageFile = strings(work, "P18")[0];
  if (!imageFile) return null;

  const creatorId = ids(work, "P170")[0];
  const collectionClaim = claims(work, "P195").find((c) => !c.qualifiers?.P582) ?? claims(work, "P195")[0];
  const collectionId = collectionClaim?.mainsnak.datavalue?.value?.id as string | undefined;
  const materialIds = ids(work, "P186").slice(0, 4);
  const related = await entities([creatorId, collectionId, ...materialIds].filter(Boolean) as string[]);
  const creator = creatorId ? related[creatorId] : undefined;
  const collection = collectionId ? related[collectionId] : undefined;

  // Public domain if Wikidata says so, or the artist died long enough ago.
  const died = year(claims(creator, "P570")[0]?.mainsnak.datavalue?.value?.time);
  const pd = ids(work, "P6216").includes(PUBLIC_DOMAIN) || (died !== undefined && died <= 1955);
  if (!pd) return null;

  const inception = claims(work, "P571")[0];
  const y = year(inception?.mainsnak.datavalue?.value?.time);
  const circa = (inception?.qualifiers?.P1480 ?? []).some((q) => q.datavalue?.value?.id === CIRCA);
  const h = quantity(work, "P2048");
  const w = quantity(work, "P2049");
  const inventory = strings(work, "P217")[0];
  const museumName = label(collection) ?? "Unknown collection";
  // The work's own page at its museum where Wikidata knows it, else its Wikidata record.
  const id = (p: string) => strings(work, p)[0];
  const objectPage =
    id("P973") ??
    (id("P3634") && `https://www.metmuseum.org/art/collection/search/${id("P3634")}`) ??
    (id("P4683") && `https://www.nga.gov/collection/art-object-page.${id("P4683")}.html`) ??
    (id("P4659") && `https://www.musee-orsay.fr/fr/oeuvres/${id("P4659")}`) ??
    (id("P4610") && `https://www.artic.edu/artworks/${id("P4610")}`);
  const museumUrl = objectPage || `https://www.wikidata.org/wiki/${qid}`;
  const image = (await commonsImages([imageFile])).get(imageFile);
  if (!image) return null;

  return {
    key: `wd-${qid.slice(1)}`,
    source: "wd",
    sourceId: Number(qid.slice(1)),
    title: titleOf(work),
    date: y ? `${circa ? "c. " : ""}${y}` : "",
    year: y,
    medium: mediumOf(materialIds.map((m) => label(related[m])).filter(Boolean) as string[]),
    dimensions: h && w ? `${h.n} × ${w.n} ${h.unit}`.trim() : undefined,
    artistName: label(creator) ?? "Unknown artist",
    museum: { name: inventory ? `${museumName} (${inventory})` : museumName, url: museumUrl },
    image,
    tags: [],
    wikidata: qid,
    aic: strings(work, "P4610")[0] ? Number(strings(work, "P4610")[0]) : undefined,
  };
}

export type WorkCandidate = { qid: string; title: string; year?: number; collection?: string; fame: number };

/** An artist's works on Wikidata that have a Commons image, most-linked first. */
export async function worksByArtist(artistQid: string, limit = 60): Promise<WorkCandidate[]> {
  if (!/^Q\d+$/.test(artistQid)) return [];
  const r = await sparql(`SELECT ?w ?wLabel ?img ?inc ?colLabel ?links WHERE {
    ?w wdt:P170 wd:${artistQid} ; wdt:P18 ?img ; wikibase:sitelinks ?links .
    OPTIONAL { ?w wdt:P571 ?inc } OPTIONAL { ?w wdt:P195 ?col }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } ORDER BY DESC(?links) LIMIT ${limit * 2}`);
  const seen = new Set<string>();
  const out: WorkCandidate[] = [];
  for (const b of r.results?.bindings ?? []) {
    const qid = String(b.w.value).split("/").pop()!;
    if (seen.has(qid) || !commonsFile(b.img.value)) continue;
    seen.add(qid);
    out.push({ qid, title: b.wLabel?.value, year: year(b.inc?.value), collection: b.colLabel?.value, fame: Number(b.links.value) });
  }
  return out.slice(0, limit);
}
