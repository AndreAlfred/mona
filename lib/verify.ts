import type { QuotePassage } from "./schema";
import { stripHtml, UA } from "./util";

/**
 * Normalise text for a verbatim comparison that tolerates typography
 * (curly vs straight quotes, dashes, line breaks, case) but not wording.
 */
export function normalize(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/­/g, "") // soft hyphen
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Split a quote into the runs of words that must appear verbatim. Ellipses
 * mark omissions and [square brackets] mark editorial insertions, so each
 * side of them is checked separately.
 */
export function segments(quote: string) {
  return quote
    .split(/\.\s?\.\s?\.|…|\[[^\]]*\]/)
    .map(normalize)
    .filter((s) => s.split(" ").length >= 3);
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyAgainstText(p: QuotePassage, pageText: string): VerifyResult {
  const page = ` ${normalize(pageText)} `;
  const segs = segments(p.text);
  if (!segs.length || Math.max(...segs.map((s) => s.split(" ").length)) < 5) {
    return { ok: false, reason: "quote too fragmentary to verify (needs a run of 5+ words)" };
  }
  for (const seg of segs) {
    if (!page.includes(` ${seg} `)) return { ok: false, reason: `not found on page: "${seg.slice(0, 80)}"` };
  }
  if (!isInstitutional(p)) {
    const surname = normalize(p.source.author).split(" ").pop()!;
    if (surname && !page.includes(` ${surname}`)) {
      return { ok: false, reason: `author "${p.source.author}" not named on the page` };
    }
  }
  return { ok: true };
}

function isInstitutional(p: QuotePassage) {
  const a = p.source.author.toLowerCase();
  return a.includes("contributors") || a === (p.source.publisher ?? "").toLowerCase() || p.source.tier === 4;
}

const pageCache = new Map<string, Promise<string>>();

/** Fetch a page as plain text. HTML is stripped; plain text passes through. */
export function fetchPageText(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    pageCache.set(
      url,
      (async () => {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        const type = res.headers.get("content-type") ?? "";
        return type.includes("html") ? stripHtml(body) : body;
      })(),
    );
  }
  return pageCache.get(url)!;
}

export async function verifyQuote(p: QuotePassage): Promise<VerifyResult> {
  try {
    return verifyAgainstText(p, await fetchPageText(p.source.readAt));
  } catch (e) {
    return { ok: false, reason: `could not fetch readAt (${(e as Error).message})` };
  }
}
