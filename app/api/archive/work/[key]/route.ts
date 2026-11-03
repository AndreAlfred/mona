import { archiveWork } from "@/lib/archive/museums";

export async function GET(_req: Request, ctx: RouteContext<"/api/archive/work/[key]">) {
  const { key } = await ctx.params;
  const work = await archiveWork(key).catch(() => null);
  if (!work) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(work, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
