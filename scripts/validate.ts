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

  const warnings: string[] = [];
  if (process.argv.includes("--images")) {
    // GATE_CHANGED (set by scripts/gate.ts) lists the content files this PR
    // adds or changes. Their images must load, full stop. Every other image
    // already passed when it was added; for those, a definite failure (404,
    // 403...) still fails, but Wikimedia rate-limiting the shared CI machines
    // (429, 5xx, timeouts) is only a warning, so it can't block good content.
    // Run standalone without GATE_CHANGED, every image is checked strictly.
    const changed = process.env.GATE_CHANGED?.split("\n").filter(Boolean);
    const strict = (file: string) => !changed || changed.some((c) => file.endsWith(c));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const head = async (url: string, tries: number) => {
      let status: number | undefined;
      for (let i = 0; i < tries; i++) {
        const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } }).catch(() => null);
        if (res && (res.ok || (res.status < 429 && res.status !== 408))) return { ok: res.ok, status: res.status, transient: false };
        status = res?.status;
        // Wait as long as the server asks (Retry-After), else back off: 2s, 4s, 8s...
        const after = Number(res?.headers.get("retry-after"));
        if (i < tries - 1) await sleep(Math.min(30_000, after > 0 ? after * 1000 : 2000 * 2 ** i));
      }
      return { ok: false, status, transient: true };
    };
    const queue = [...works];
    const check = async ({ file, value: w }: (typeof works)[number]) => {
      // AIC's image server doesn't serve images embedded in other sites, so
      // these cards would show blank. Use the Commons photograph instead.
      if (/artic\.edu\/iiif\//.test(w.image.url)) {
        problems.push(`${file}: AIC image URLs don't display when embedded; use the Wikimedia Commons image (npm run commons-images)`);
        return;
      }
      const isStrict = strict(file);
      const res = await head(w.image.url, isStrict ? 5 : 2);
      if (res.ok) return;
      const why = res.status ? `HTTP ${res.status}` : "no response";
      if (isStrict || !res.transient) problems.push(`${file}: image not reachable (${why})`);
      else warnings.push(`${file}: image check inconclusive (${why}, likely rate-limited); it passed when it was added`);
    };
    // Three at a time: Wikimedia rate-limits bursts from shared CI addresses.
    await Promise.all(Array.from({ length: 3 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await check(job);
    }));
  }

  if (warnings.length) console.warn(warnings.map((w) => `⚠ ${w}`).join("\n"));

  console.log(`${artists.length} artists, ${works.length} works, ${tags.length} tags, ${archive.length} archive artists`);
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("✓ content valid");
}

main();
