/**
 * Scaffold a curated work from a museum record, so facts that come from the
 * museum (title, date, medium, image, licence, links) are never retyped.
 *   npm run new-work -- aic-28560 vincent-van-gogh [work-id]
 * Writes content/works/<work-id>.json with empty sections for the agent to fill.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveWork } from "../lib/archive/museums";
import { slugify, today } from "../lib/util";

async function main() {
  const [key, artist, idArg] = process.argv.slice(2);
  if (!key || !artist) {
    console.error("usage: npm run new-work -- <aic-123|cma-456> <artist-id> [work-id]");
    process.exit(1);
  }
  const w = await archiveWork(key);
  if (!w) {
    console.error(`no public-domain imaged record for ${key}`);
    process.exit(1);
  }
  const id = idArg ?? slugify(`${artist.split("-").pop()} ${w.title}`);
  const file = join(process.cwd(), "content/works", `${id}.json`);
  if (existsSync(file)) {
    console.error(`${file} already exists`);
    process.exit(1);
  }
  const year = w.year ?? Number(/\d{4}/.exec(w.date)?.[0] ?? 0);
  const work = {
    id,
    artist,
    title: w.title,
    date: w.date,
    year,
    medium: w.medium,
    dimensions: w.dimensions,
    museum: { name: w.museum.name, url: w.museum.url },
    image: w.image,
    archive: { [w.source]: w.sourceId },
    phase: { label: "TODO period/phase of the artist's career", ai: true },
    tags: [],
    sections: { work: [], moment: [], matters: [] },
    curated: { on: today(), by: "TODO agent name" },
    _museumText: w.museumText?.text, // for reference while writing; delete before committing
  };
  writeFileSync(file, JSON.stringify(work, null, 2) + "\n");
  console.log(`wrote ${file}`);
  if (w.museumText) console.log(`museum text available (tier 4, readAt ${w.museumText.source.readAt})`);
}

main();
