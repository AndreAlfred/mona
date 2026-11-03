import { aicWorksByArtist, cmaWorksByCreator } from "@/lib/archive/museums";

const CACHE = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const aic = Number(q.get("aic")) || undefined;
  const cma = (q.get("cma") ?? "").split(",").map(Number).filter(Boolean).slice(0, 4);
  const results = await Promise.all([
    aic ? aicWorksByArtist(aic).catch(() => []) : [],
    ...cma.map((c) => cmaWorksByCreator(c).catch(() => [])),
  ]);
  // Alternate museums so a run isn't all from one collection.
  const out = [];
  for (let i = 0; results.some((r) => r[i]); i++) for (const r of results) if (r[i]) out.push(r[i]);
  return Response.json(out, { headers: CACHE });
}
