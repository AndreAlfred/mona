/**
 * The Art Institute of Chicago's image server doesn't serve images embedded
 * in other sites (it refuses cross-site requests, even though its docs
 * welcome hotlinking). Wikimedia Commons hosts public-domain photographs of
 * most pre-1930 art and is built to be embedded, so Mona shows Commons
 * photographs for AIC works and for works from any other museum (resolved
 * through Wikidata: P4610 = AIC artwork ID, P18 = image).
 */
import type { CardImage } from "../types";
import { UA } from "../util";

const WIDTH = 1200;

export async function wdJson(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json, application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export const sparql = (query: string) =>
  wdJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);

/** "http://commons.wikimedia.org/wiki/Special:FilePath/X.jpg" -> "X.jpg" */
export const commonsFile = (filePathUrl: string) =>
  decodeURIComponent(String(filePathUrl).split("/Special:FilePath/")[1] ?? "");

/** Resolve Commons file names to sized, embeddable image records. */
export async function commonsImages(files: string[]): Promise<Map<string, CardImage>> {
  const out = new Map<string, CardImage>();
  const unique = [...new Set(files.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 50) {
    const titles = unique.slice(i, i + 50).map((f) => `File:${f}`).join("|");
    const r = await wdJson(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|size&iiurlwidth=${WIDTH}&titles=${encodeURIComponent(titles)}`,
    );
    const norm = new Map<string, string>((r.query?.normalized ?? []).map((n: any) => [n.to, n.from]));
    for (const p of r.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const file = (norm.get(p.title) ?? p.title).replace(/^File:/, "");
      out.set(file, {
        url: ii.thumburl,
        // Commons can't upscale, so only offer a sharper version of large originals.
        large: ii.width >= 2560 ? ii.thumburl.replace(/\/\d+px-/, "/2560px-") : undefined,
        width: ii.thumbwidth,
        height: ii.thumbheight,
        license: "Public domain",
        credit: `Photograph via Wikimedia Commons (${file})`,
      });
    }
  }
  return out;
}

/** Prefer a photograph of the AIC object itself over another impression or copy. */
function rank(file: string) {
  if (/Art Institute of Chicago/i.test(file)) return 0;
  if (/Google Art Project/i.test(file)) return 1;
  return 2;
}

export async function commonsImagesForAic(ids: number[]): Promise<Map<number, CardImage>> {
  const out = new Map<number, CardImage>();
  const unique = [...new Set(ids)].slice(0, 150);
  if (!unique.length) return out;
  const res = await sparql(
    `SELECT ?id ?img WHERE { VALUES ?id { ${unique.map((i) => `"${i}"`).join(" ")} } ?item wdt:P4610 ?id ; wdt:P18 ?img . }`,
  );
  const best = new Map<number, string>();
  for (const b of res.results?.bindings ?? []) {
    const id = Number(b.id.value);
    const file = commonsFile(b.img.value);
    if (!file) continue;
    const prev = best.get(id);
    if (!prev || rank(file) < rank(prev)) best.set(id, file);
  }
  const images = await commonsImages([...best.values()]);
  for (const [id, file] of best) {
    const img = images.get(file) ?? images.get(file.replace(/_/g, " "));
    if (img) out.set(id, img);
  }
  return out;
}
