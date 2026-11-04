/**
 * Content gate, part 1: schema, references, quote limits, images.
 *   npm run validate            # everything
 *   npm run validate -- --images   # also check every image URL responds
 */
import { loadContent, passagesOf, isQuote } from "../lib/content";
import { QUOTE_WORD_LIMIT } from "../lib/schema";
import { UA } from "../lib/util";
import { readFileSync } from "node:fs";

async function main() {
  const { artists, works, tags, archive, errors } = loadContent();
  const problems = errors.map((e) => `${e.file}: ${e.message}`);
  const artistIds = new Set(artists.map((a) => a.value.id));
  const archiveIds = new Set(archive.map((a) => a.id));
  const tagIds = new Set(tags.map((t) => t.value.id));
  const workIds = new Set<string>();

  const artistName = new Map(artists.map((a) => [a.value.id, a.value.name]));
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const checkPassages = (file: string, kind: "artist" | "work" | "tag", v: any, artist?: string) => {
    const perSource = new Map<string, number>();
    for (const { where, p } of passagesOf(kind, v)) {
      if (p.kind === "ai" && p.text.split(/\s+/).length > 90) problems.push(`${file} ${where}: AI note over 90 words`);
      if (!isQuote(p)) continue;
      // Tier 1 is shown as "Artist": only the artist's own words qualify.
      if (artist && p.source.tier === 1) {
        const words = fold(artist).split(/[\s-]+/);
        if (!fold(p.source.author).split(/[\s-]+/).some((w: string) => w.length > 2 && words.includes(w)))
          problems.push(`${file} ${where}: tier 1 (Artist) is for ${artist}'s own words, not ${p.source.author}; use tier 2/3`);
      }
      const n = p.text.split(/\s+/).filter(Boolean).length;
      if (n > QUOTE_WORD_LIMIT) problems.push(`${file} ${where}: quote is ${n} words (limit ${QUOTE_WORD_LIMIT})`);
      if (p.source.tier === 2 || p.source.tier === 3) {
        const k = `${p.source.author}|${p.source.title}`;
        perSource.set(k, (perSource.get(k) ?? 0) + 1);
      }
    }
    for (const [k, n] of perSource) if (n > 2) problems.push(`${file}: ${n} quotes from one source (${k}); max 2`);
  };

  for (const { file, value: a } of artists) {
    for (const m of a.movements) if (!tagIds.has(m.id)) problems.push(`${file}: unknown movement tag ${m.id}`);
    for (const p of a.peers)
      if (!artistIds.has(p.id) && !archiveIds.has(p.id)) problems.push(`${file}: peer ${p.id} is neither curated nor in the archive index`);
    checkPassages(file, "artist", a, a.name);
  }
  for (const { file, value: t } of tags) checkPassages(file, "tag", t);
  for (const { file } of [...artists, ...works, ...tags]) {
    const raw = readFileSync(file, "utf8");
    if (/TODO|_museumText/.test(raw)) problems.push(`${file}: leftover TODO or _museumText scaffold field`);
  }
  for (const { file, value: w } of works) {
    if (workIds.has(w.id)) problems.push(`${file}: duplicate work id ${w.id}`);
    workIds.add(w.id);
    if (!artistIds.has(w.artist)) problems.push(`${file}: unknown artist ${w.artist}`);
    for (const t of w.tags) if (!tagIds.has(t.id)) problems.push(`${file}: unknown tag ${t.id}`);
    const lead = (s: any[]) => s.find(Boolean);
    for (const [name, list] of Object.entries(w.sections)) {
      if (list.length && list[0].kind === "ai" && list.some((p) => p.kind === "quote"))
        problems.push(`${file}: section ${name} leads with AI although a human quote exists`);
      void lead;
    }
    checkPassages(file, "work", w, artistName.get(w.artist));
  }

  if (process.argv.includes("--images")) {
    // A few at a time, with retries: Wikimedia drops bursts of requests.
    const head = async (url: string) => {
      for (let i = 0; i < 3; i++) {
        const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } }).catch(() => null);
        if (res?.ok || (res && res.status < 429)) return res;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
      return null;
    };
    const queue = [...works];
    const check = async ({ file, value: w }: (typeof works)[number]) => {
        // AIC's image server doesn't serve images embedded in other sites, so
        // these cards would show blank. Use the Commons photograph instead.
        if (/artic\.edu\/iiif\//.test(w.image.url)) {
          problems.push(`${file}: AIC image URLs don't display when embedded; use the Wikimedia Commons image (npm run commons-images)`);
          return;
        }
        const res = await head(w.image.url);
        if (!res?.ok) problems.push(`${file}: image not reachable (${res?.status ?? "network"})`);
    };
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await check(job);
    }));
  }

  console.log(`${artists.length} artists, ${works.length} works, ${tags.length} tags, ${archive.length} archive artists`);
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("✓ content valid");
}

main();
