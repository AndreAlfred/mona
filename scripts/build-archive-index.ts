/**
 * Builds content/archive-artists.json: artists with enough public-domain,
 * imaged works at the Art Institute of Chicago (AIC) and the Cleveland
 * Museum of Art (CMA) to sustain a depth-first run in the feed.
 *
 * Run occasionally (it pages through both collections, ~2–4 minutes):
 *   npm run archive-index
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { periodForYear } from "../lib/schema";
import { slugify, normName, UA } from "../lib/util";

type Entry = {
  id: string;
  name: string;
  born?: number;
  died?: number;
  nationality?: string;
  period: string;
  aic?: number;
  cma?: number[];
  count: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BAD_NAME =
  /unknown|anonymous|unidentified|workshop|circle of|follower|school|manner of|after |attributed|style of|studio|probably|possibly|^various|manufactory|company|& co/i;

async function getJson(url: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) } });
    if (res.ok) return res.json();
    console.error(`\n${res.status} ${url.slice(0, 120)}`);
    await sleep(5000 * (attempt + 1));
  }
  throw new Error(`failed: ${url}`);
}

async function cma() {
  const byCreator = new Map<number, { name: string; born?: number; died?: number; nationality?: string; n: number }>();
  for (const type of ["Painting", "Print", "Drawing"]) {
    for (let skip = 0; ; skip += 1000) {
      const url = `https://openaccess-api.clevelandart.org/api/artworks/?type=${type}&cc0=1&has_image=1&created_before=1930&limit=1000&skip=${skip}&fields=id,creators,department`;
      const { data } = await getJson(url);
      for (const w of data) {
        // Prints and drawings only from departments where they are the main tradition.
        if (type !== "Painting" && !/Japanese|Chinese|Prints|Drawings/i.test(w.department ?? "")) continue;
        const c = (w.creators ?? []).find((c: any) => c.role === "artist");
        if (!c) continue;
        const name = String(c.description ?? "").replace(/\s*\(.*$/, "").trim();
        if (!name || BAD_NAME.test(name) || BAD_NAME.test(c.qualifier ?? "")) continue;
        const nat = /\(([A-Z][a-z]+)/.exec(c.description ?? "")?.[1];
        const prev = byCreator.get(c.id) ?? {
          name,
          born: c.birth_year ? Number.parseInt(c.birth_year) : undefined,
          died: c.death_year ? Number.parseInt(c.death_year) : undefined,
          nationality: nat,
          n: 0,
        };
        prev.n += type === "Painting" ? 1 : 0.5;
        byCreator.set(c.id, prev);
      }
      process.stdout.write(`cma ${type} ${skip + data.length}\r`);
      if (data.length < 1000) break;
      await sleep(300);
    }
  }
  return byCreator;
}

async function aic() {
  const counts = new Map<number, number>();
  const search = (type: string, from: number, to: number, page: number, limit: number) => {
    const params = {
      query: {
        bool: {
          must: [
            { term: { is_public_domain: true } },
            { exists: { field: "image_id" } },
            { match: { artwork_type_title: type } },
            { range: { date_end: { gte: from, lte: to } } },
          ],
          // Prints and drawings: only museum highlights and East Asian traditions.
          ...(type === "Painting"
            ? {}
            : {
                should: [
                  { term: { is_boosted: true } },
                  { match: { place_of_origin: "Japan" } },
                  { match: { place_of_origin: "China" } },
                ],
                minimum_should_match: 1,
              }),
        },
      },
      fields: ["artist_id"],
      limit,
      page,
    };
    return getJson(`https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`);
  };
  // AIC caps any one search at 1,000 results, so walk date slices, halving any that are too big.
  const walk = async (type: string, from: number, to: number): Promise<void> => {
    const head = await search(type, from, to, 1, 0);
    await sleep(1100);
    const total: number = head.pagination.total;
    if (total === 0) return;
    if (total > 1000 && to - from > 1) {
      const mid = Math.floor((from + to) / 2);
      await walk(type, from, mid);
      await walk(type, mid + 1, to);
      return;
    }
    for (let page = 1; page <= Math.min(10, Math.ceil(total / 100)); page++) {
      const json = await search(type, from, to, page, 100);
      for (const w of json.data) {
        if (!w.artist_id) continue;
        counts.set(w.artist_id, (counts.get(w.artist_id) ?? 0) + (type === "Painting" ? 1 : 0.5));
      }
      process.stdout.write(`aic ${type} ${from}–${to} page ${page}\r`);
      await sleep(1100); // AIC asks for <= 60 requests/minute
    }
  };
  for (const type of ["Painting", "Print", "Drawing and Watercolor"]) await walk(type, -3000, 1930);
  const ids = [...counts.keys()];
  const agents = new Map<number, any>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const json = await getJson(
      `https://api.artic.edu/api/v1/agents?ids=${chunk.join(",")}&limit=100&fields=id,title,birth_date,death_date`,
    );
    for (const a of json.data) agents.set(a.id, a);
    await sleep(1100);
  }
  return { counts, agents };
}

async function main() {
  const [c, a] = [await cma(), await aic()];
  const merged = new Map<string, Entry>();
  const keyOf = (name: string, born?: number) => `${normName(name)}|${born ?? "?"}`;

  for (const [id, v] of c) {
    const k = keyOf(v.name, v.born);
    const e = merged.get(k) ?? {
      id: slugify(v.name),
      name: v.name,
      born: v.born,
      died: v.died,
      nationality: v.nationality,
      period: "",
      count: 0,
    };
    e.cma = [...(e.cma ?? []), id];
    e.count += v.n;
    merged.set(k, e);
  }
  for (const [id, n] of a.counts) {
    const ag = a.agents.get(id);
    if (!ag?.title || BAD_NAME.test(ag.title)) continue;
    const born = ag.birth_date ?? undefined;
    const k = keyOf(ag.title, born);
    // Fall back to a name-only match when one side lacks a birth year.
    const alt = [...merged.entries()].find(([kk]) => kk.startsWith(`${normName(ag.title)}|`))?.[0];
    const key = merged.has(k) ? k : alt ?? k;
    const e: Entry = merged.get(key) ?? {
      id: slugify(ag.title),
      name: ag.title,
      born,
      died: ag.death_date ?? undefined,
      period: "",
      count: 0,
    };
    e.aic = id;
    e.count += n;
    e.born ??= born;
    merged.set(key, e);
  }

  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of [...merged.values()].sort((x, y) => y.count - x.count)) {
    if (e.count < 4 || !e.born) continue;
    // Cultures and schools ("Venetian", born 1000, died 1900) are not artists.
    if (e.born < 1150 || (e.died && e.died - e.born > 105)) continue;
    const mid = e.born + 35;
    if (mid > 1930) continue;
    e.period = periodForYear(mid);
    e.count = Math.round(e.count);
    let id = e.id;
    for (let i = 2; seen.has(id); i++) id = `${e.id}-${i}`;
    seen.add(id);
    out.push({ ...e, id });
  }
  out.sort((x, y) => (x.born ?? 0) - (y.born ?? 0));
  writeFileSync(join(process.cwd(), "content/archive-artists.json"), JSON.stringify(out, null, 1) + "\n");
  const byPeriod = out.reduce<Record<string, number>>((m, e) => ((m[e.period] = (m[e.period] ?? 0) + 1), m), {});
  console.log(`\n${out.length} archive artists`, byPeriod);
}

main();
