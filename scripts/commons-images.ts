/**
 * Point curated works that use AIC image URLs at their Wikimedia Commons
 * photograph instead (AIC's image server doesn't serve cross-site embeds).
 *   npm run commons-images            # rewrite in place, list any left over
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadContent } from "../lib/content";
import { commonsImagesForAic } from "../lib/archive/commons";

async function main() {
  const { works } = loadContent();
  const aic = works.filter((w) => /artic\.edu\/iiif/.test(w.value.image.url));
  const images = await commonsImagesForAic(aic.map((w) => w.value.archive?.aic).filter((x): x is number => !!x));
  const missing: string[] = [];
  for (const { file, value: w } of aic) {
    const img = w.archive?.aic ? images.get(w.archive.aic) : undefined;
    if (!img) {
      missing.push(`${w.id} (aic ${w.archive?.aic})`);
      continue;
    }
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.image = Object.fromEntries(Object.entries(img).filter(([, v]) => v !== undefined));
    writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
    console.log(`✓ ${w.id} → ${img.credit}`);
  }
  if (missing.length) console.log(`no Commons image: ${missing.join(", ")}`);
}

main();
