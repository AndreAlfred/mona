/**
 * Content gate, part 2: every quote must appear verbatim on its readAt page,
 * and the credited author must be named there.
 *   npm run verify-quotes                    # all content
 *   npm run verify-quotes -- content/works/x.json ...   # only these files
 */
import { loadContent, passagesOf, isQuote } from "../lib/content";
import { verifyQuote } from "../lib/verify";
import { resolve } from "node:path";

async function main() {
  const only = process.argv.slice(2).filter((a) => a.endsWith(".json")).map((f) => resolve(f));
  const { artists, works, tags, errors } = loadContent();
  if (errors.length) {
    console.error("schema errors; run npm run validate first");
    process.exit(1);
  }
  const records = [
    ...artists.map((r) => ({ ...r, kind: "artist" as const })),
    ...works.map((r) => ({ ...r, kind: "work" as const })),
    ...tags.map((r) => ({ ...r, kind: "tag" as const })),
  ].filter((r) => !only.length || only.includes(r.file));

  const jobs = records.flatMap((r) =>
    passagesOf(r.kind, r.value)
      .filter((x) => isQuote(x.p))
      .map((x) => ({ file: r.file, where: x.where, p: x.p as any })),
  );
  let failed = 0;
  // Modest concurrency; be polite to source sites.
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = jobs.slice(i, i + 6);
    const results = await Promise.all(batch.map((j) => verifyQuote(j.p)));
    results.forEach((r, k) => {
      if (!r.ok) {
        failed++;
        const j = batch[k];
        console.error(`✗ ${j.file} ${j.where}\n    ${r.reason}\n    readAt: ${j.p.source.readAt}`);
      }
    });
  }
  console.log(`${jobs.length - failed}/${jobs.length} quotes verified`);
  if (failed) process.exit(1);
}

main();
