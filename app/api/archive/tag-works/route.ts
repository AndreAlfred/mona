import { aicWorksByTerm } from "@/lib/archive/museums";

export async function GET(req: Request) {
  const term = new URL(req.url).searchParams.get("term")?.slice(0, 80);
  if (!term) return Response.json([], { status: 400 });
  const works = await aicWorksByTerm(term).catch(() => []);
  return Response.json(works, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
