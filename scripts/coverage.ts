/** Where curated content is thinnest. Agents use this to choose what to curate next. */
import { loadContent } from "../lib/content";
import { PERIODS } from "../lib/schema";

const { artists, works, tags, archive } = loadContent();
const byArtist = new Map<string, number>();
for (const { value: w } of works) byArtist.set(w.artist, (byArtist.get(w.artist) ?? 0) + 1);
console.log("Curated artists by period (works):");
for (const p of PERIODS) {
  const list = artists.filter((a) => a.value.period === p.id);
  const n = list.reduce((s, a) => s + (byArtist.get(a.value.id) ?? 0), 0);
  const candidates = archive.filter((a) => a.period === p.id).length;
  console.log(
    `  ${p.name.padEnd(30)} ${String(list.length).padStart(2)} artists, ${String(n).padStart(3)} works  (${candidates} archive candidates)` +
      (list.length ? `  — ${list.map((a) => a.value.name).join(", ")}` : ""),
  );
}
const tagUse = new Map<string, number>();
for (const { value: w } of works) for (const t of w.tags) tagUse.set(t.id, (tagUse.get(t.id) ?? 0) + 1);
console.log(`\nTags (${tags.length}): ${tags.map((t) => `${t.value.id}(${tagUse.get(t.value.id) ?? 0})`).join(", ")}`);
const thin = artists.filter((a) => (byArtist.get(a.value.id) ?? 0) < 10).map((a) => `${a.value.id}(${byArtist.get(a.value.id) ?? 0})`);
if (thin.length) console.log(`\nCurated artists under 10 works: ${thin.join(", ")}`);
