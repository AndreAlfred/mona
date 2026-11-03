/**
 * Compiles content/ into static JSON the browser fetches:
 *   public/data/catalog.json        everything needed to plan a feed
 *   public/data/works/<id>.json     full curated work
 *   public/data/artists/<id>.json   full curated artist (with bio)
 *   public/data/archive-artists.json
 * Fails the build on schema errors.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadContent } from "../lib/content";
import type { Catalog } from "../lib/types";

const out = join(process.cwd(), "public/data");
const { artists, works, tags, archive, errors } = loadContent();
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e.file}: ${e.message}`).join("\n"));
  process.exit(1);
}

for (const sub of ["works", "artists"]) {
  const dir = join(out, sub);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) unlinkSync(join(dir, f)); // drop stale files
}

const catalog: Catalog = { generatedAt: new Date().toISOString(), artists: {}, tags: {}, works: {} };
for (const { value: t } of tags) catalog.tags[t.id] = t;
for (const { value: a } of artists) {
  const { bio: _bio, ...rest } = a;
  catalog.artists[a.id] = { ...rest, workIds: [] };
  writeFileSync(join(out, "artists", `${a.id}.json`), JSON.stringify(a));
}
for (const { value: w } of [...works].sort((x, y) => x.value.year - y.value.year)) {
  catalog.works[w.id] = {
    id: w.id,
    artist: w.artist,
    title: w.title,
    date: w.date,
    year: w.year,
    archive: w.archive,
    tags: w.tags.map((t) => t.id),
    thumb: w.image.url,
  };
  catalog.artists[w.artist]?.workIds.push(w.id);
  writeFileSync(join(out, "works", `${w.id}.json`), JSON.stringify(w));
}
writeFileSync(join(out, "catalog.json"), JSON.stringify(catalog));
if (existsSync(join(process.cwd(), "content/archive-artists.json")))
  writeFileSync(join(out, "archive-artists.json"), JSON.stringify(archive));
console.log(`data: ${artists.length} artists, ${works.length} works, ${tags.length} tags, ${archive.length} archive artists`);
