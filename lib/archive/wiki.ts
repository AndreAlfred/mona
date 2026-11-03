import type { ArtistContext } from "../types";
import type { QuotePassage } from "../schema";
import { QUOTE_WORD_LIMIT } from "../schema";
import { stripHtml, today, UA } from "../util";

async function json(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const PAGE_PROPS =
  "prop=pageprops|extracts|info&inprop=url&exintro=1&explaintext=1&exsentences=4&ppprop=wikibase_item|disambiguation";

type WikiPage = { title: string; extract?: string; fullurl: string; missing?: boolean; pageprops?: { wikibase_item?: string; disambiguation?: string } };

/** Find the artist's English Wikipedia page, intro text, and Wikidata id. */
async function wikipedia(name: string): Promise<WikiPage | null> {
  const base = "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&";
  const direct = await json(`${base}${PAGE_PROPS}&titles=${encodeURIComponent(name)}`);
  const d: WikiPage | undefined = direct.query?.pages?.[0];
  if (d && !d.missing && d.pageprops?.wikibase_item && d.pageprops.disambiguation === undefined) return d;
  const res = await json(
    `${base}${PAGE_PROPS}&generator=search&gsrlimit=5&gsrsearch=${encodeURIComponent(`${name} painter`)}`,
  );
  const pages: (WikiPage & { index: number })[] = (res.query?.pages ?? []).sort((a: any, b: any) => a.index - b.index);
  const surname = name.split(/\s+/).pop()!.toLowerCase();
  return (
    pages.find(
      (p) =>
        !/^(list|lists) of/i.test(p.title) &&
        p.pageprops?.disambiguation === undefined &&
        p.title.toLowerCase().includes(surname),
    ) ?? null
  );
}

async function wikidata(qid: string) {
  const res = await json(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const ent = res.entities?.[qid];
  const ids = (p: string) =>
    (ent?.claims?.[p] ?? []).map((c: any) => c.mainsnak?.datavalue?.value?.id).filter(Boolean) as string[];
  const movementIds = ids("P135").slice(0, 4);
  const influenceIds = [...ids("P737"), ...ids("P1066")].slice(0, 6);
  const all = [...movementIds, ...influenceIds];
  let labels: Record<string, string> = {};
  if (all.length) {
    const l = await json(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${all.join("|")}`,
    );
    labels = Object.fromEntries(
      Object.entries(l.entities ?? {}).map(([k, v]: [string, any]) => [k, v.labels?.en?.value ?? ""]),
    );
  }
  return {
    wikiquote: ent?.sitelinks?.enwikiquote?.title as string | undefined,
    movements: movementIds.map((i) => labels[i]).filter(Boolean),
    influences: influenceIds.map((i) => labels[i]).filter(Boolean),
  };
}

/**
 * Pull the artist's own words from Wikiquote. Only sections of quotes *by*
 * the artist; never "Disputed", "Misattributed" or "Quotes about".
 */
export function parseWikiquote(html: string, max = 4): { text: string; cite: string }[] {
  const sections = html.split(/<div class="mw-heading mw-heading2">/);
  const keep = sections.filter((s, i) => {
    if (i === 0) return false;
    const h = /<h2 id="([^"]+)"/.exec(s)?.[1] ?? "";
    return /^(Quotes|Sourced|Letters|Writings|Attributed_to_\w+$)?/i.test(h) &&
      /quote|sourced|letter|writing|\d{4}/i.test(h) &&
      !/about|disputed|misattributed|attributed|external|see_also|reference|unsourced|by_others/i.test(h);
  });
  const out: { text: string; cite: string }[] = [];
  for (const sec of keep) {
    // Walk list tags, tracking depth. Depth-1 <li> = quote, depth-2 <li> = its source.
    const re = /<(\/?)(ul|li)\b[^>]*>/gi;
    let depth = 0;
    let quoteStart = -1;
    let quoteHtml = "";
    let citeHtml = "";
    let citeStart = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sec))) {
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      if (tag === "ul") {
        if (!closing) {
          depth++;
          if (depth === 2 && quoteStart >= 0) quoteHtml = sec.slice(quoteStart, m.index);
        } else depth--;
        continue;
      }
      if (!closing && depth === 1) {
        quoteStart = re.lastIndex;
        quoteHtml = "";
        citeHtml = "";
      } else if (!closing && depth === 2 && !citeHtml) {
        citeStart = re.lastIndex;
      } else if (closing && depth === 2 && citeStart >= 0 && !citeHtml) {
        citeHtml = sec.slice(citeStart, m.index);
        citeStart = -1;
      } else if (closing && depth === 1 && quoteStart >= 0) {
        if (!quoteHtml) quoteHtml = sec.slice(quoteStart, m.index);
        const text = stripHtml(quoteHtml).replace(/\s+/g, " ").trim();
        const cite = stripHtml(citeHtml).replace(/\s+/g, " ").trim();
        if (cite && !/^(quote|version|text)? ?in original|^original\b|\(origineel|\(citaat/i.test(text) && words(text) >= 8 && words(text) <= QUOTE_WORD_LIMIT) out.push({ text, cite });
        quoteStart = -1;
      }
    }
  }
  // Spread picks across the page rather than only the first few.
  if (out.length <= max) return out;
  const step = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
}

export async function artistContext(name: string): Promise<ArtistContext> {
  const ctx: ArtistContext = { quotes: [], movements: [], influences: [] };
  const page = await wikipedia(name).catch(() => null);
  if (!page) return ctx;
  ctx.wikipediaTitle = page.title;
  if (page.extract) {
    ctx.summary = {
      kind: "quote",
      text: page.extract.split(/\s+/).slice(0, QUOTE_WORD_LIMIT).join(" ").replace(/([^.])$/, "$1…"),
      source: {
        author: "Wikipedia contributors",
        title: page.title,
        publisher: "Wikipedia",
        readAt: page.fullurl,
        accessed: today(),
        tier: 5,
        license: "CC BY-SA 4.0",
      },
    };
  }
  const qid = page.pageprops?.wikibase_item;
  if (!qid) return ctx;
  const wd = await wikidata(qid).catch(() => null);
  if (!wd) return ctx;
  ctx.movements = wd.movements;
  ctx.influences = wd.influences;
  if (wd.wikiquote) {
    const wq = await json(
      `https://en.wikiquote.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&redirects=1&page=${encodeURIComponent(wd.wikiquote)}`,
    ).catch(() => null);
    const html: string = wq?.parse?.text ?? "";
    const readAt = `https://en.wikiquote.org/wiki/${encodeURIComponent(wd.wikiquote.replace(/ /g, "_"))}`;
    ctx.quotes = parseWikiquote(html).map(
      (q): QuotePassage => ({
        kind: "quote",
        text: q.text,
        source: {
          author: name,
          title: q.cite.length > 160 ? q.cite.slice(0, 157) + "…" : q.cite,
          publisher: "via Wikiquote",
          readAt,
          accessed: today(),
          tier: 1,
          license: "CC BY-SA 4.0",
        },
      }),
    );
  }
  return ctx;
}
