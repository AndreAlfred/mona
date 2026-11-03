/**
 * List an artist's public-domain works on Wikidata (with a Commons photo),
 * most-linked first, marking ones Mona already has. Pick from these, then
 * scaffold with `npm run new-work -- wd-Q… <artist-id>`.
 *   npm run find-works -- georges-seurat        # curated artist (uses its wikidata id)
 *   npm run find-works -- Q34013                # any Wikidata artist
 */
import { loadContent } from "../lib/content";
import { worksByArtist } from "../lib/archive/wikidata";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npm run find-works -- <artist-id|Q-id>");
    process.exit(1);
  }
  const { artists, works } = loadContent();
  const qid = /^Q\d+$/.test(arg) ? arg : artists.find((a) => a.value.id === arg)?.value.wikidata;
  if (!qid) {
    console.error(`no Wikidata id for ${arg}; pass the artist's Q-id instead`);
    process.exit(1);
  }
  const have = new Set(works.map((w) => w.value.archive?.wd).filter(Boolean));
  const list = await worksByArtist(qid);
  for (const c of list)
    console.log(`${have.has(c.qid) ? "✓ have " : "       "}wd-${c.qid}  ${c.year ?? "    "}  ${c.title}  —  ${c.collection ?? "?"}  (${c.fame} wiki links)`);
  console.log(`\n${list.length} candidates. Scaffold one with: npm run new-work -- wd-<Q-id> <artist-id>`);
}

main();
