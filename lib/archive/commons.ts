/**
 * The Art Institute of Chicago's image server doesn't serve images embedded
 * in other sites (it refuses cross-site requests, even though its docs
 * welcome hotlinking). Wikimedia Commons hosts public-domain photographs of
 * many AIC works and is built to be embedded, so we resolve AIC artwork ids
 * to Commons files through Wikidata (P4610 = Art Institute of Chicago
 * artwork ID, P18 = image).
 */
import type { CardImage } from "../types";
import { UA } from "../util";

const WIDTH = 1200;

async function json(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json, application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
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

  const query = `SELECT ?id ?img WHERE { VALUES ?id { ${unique.map((i) => `"${i}"`).join(" ")} } ?item wdt:P4610 ?id ; wdt:P18 ?img . }`;
  const res = await json(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);
  const best = new Map<number, string>();
  for (const b of res.results?.bindings ?? []) {
    const id = Number(b.id.value);
    const file = decodeURIComponent(String(b.img.value).split("/Special:FilePath/")[1] ?? "");
    if (!file) continue;
    const prev = best.get(id);
    if (!prev || rank(file) < rank(prev)) best.set(id, file);
  }
  if (!best.size) return out;

  // Resolve files to direct, sized thumbnail URLs (50 titles per request).
  const files = [...new Set(best.values())];
  const info = new Map<string, { thumb: string; large?: string; w?: number; h?: number }>();
  for (let i = 0; i < files.length; i += 50) {
    const titles = files.slice(i, i + 50).map((f) => `File:${f}`).join("|");
    const r = await json(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|size&iiurlwidth=${WIDTH}&titles=${encodeURIComponent(titles)}`,
    );
    const norm = new Map<string, string>((r.query?.normalized ?? []).map((n: any) => [n.to, n.from]));
    for (const p of r.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const title: string = norm.get(p.title) ?? p.title;
      info.set(title.replace(/^File:/, ""), {
        thumb: ii.thumburl,
        // Commons can't upscale, so only offer a sharper version of large originals.
        large: ii.width >= 2560 ? ii.thumburl.replace(/\/\d+px-/, "/2560px-") : undefined,
        w: ii.thumbwidth,
        h: ii.thumbheight,
      });
    }
  }
  for (const [id, file] of best) {
    const i = info.get(file) ?? info.get(file.replace(/_/g, " "));
    if (!i) continue;
    out.set(id, {
      url: i.thumb,
      large: i.large,
      width: i.w,
      height: i.h,
      license: "Public domain",
      credit: `Photograph via Wikimedia Commons (${file})`,
    });
  }
  return out;
}
