import { artistContext } from "@/lib/archive/wiki";

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.slice(0, 120);
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  const ctx = await artistContext(name).catch(() => ({ quotes: [], movements: [], influences: [] }));
  return Response.json(ctx, {
    headers: { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" },
  });
}
