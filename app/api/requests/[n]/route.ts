import { requestStatus } from "@/lib/github";

export async function GET(_req: Request, ctx: RouteContext<"/api/requests/[n]">) {
  const n = Number((await ctx.params).n);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    return Response.json(await requestStatus(n), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
