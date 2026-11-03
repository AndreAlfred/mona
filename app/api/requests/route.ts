import { timingSafeEqual } from "node:crypto";
import archive from "@/content/archive-artists.json";
import { archiveWork } from "@/lib/archive/museums";
import { createRequest, findOpenRequest, type RequestSubject } from "@/lib/github";

const KEY = {
  work: /^(aic|cma)-\d{1,9}$/,
  artist: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  tag: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
};

function passOk(given: unknown) {
  const want = process.env.MONA_PASSPHRASE ?? "";
  if (!want || typeof given !== "string") return false;
  const a = Buffer.from(given.trim().toLowerCase());
  const b = Buffer.from(want.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!passOk(body.passphrase)) return Response.json({ error: "passphrase" }, { status: 401 });
  const type = body.type as RequestSubject["type"];
  const key = String(body.key ?? "");
  if (!(type in KEY) || !KEY[type].test(key) || key.length > 80) {
    return Response.json({ error: "bad subject" }, { status: 400 });
  }
  const subject: RequestSubject = { type, key };

  // Titles come from our own lookups, never from client text.
  let title: string;
  let details: Record<string, unknown> = {};
  if (type === "work") {
    const w = await archiveWork(key).catch(() => null);
    if (!w) return Response.json({ error: "unknown work" }, { status: 404 });
    title = `${w.title} — ${w.artistName}`;
    details = { title: w.title, artist: w.artistName, museum: w.museum.url };
  } else if (type === "artist") {
    const a = (archive as { id: string; name: string; aic?: number; cma?: number[] }[]).find((x) => x.id === key);
    if (!a) return Response.json({ error: "unknown artist" }, { status: 404 });
    title = a.name;
    details = { name: a.name, aic: a.aic, cma: a.cma };
  } else {
    title = `tag “${key.replace(/-/g, " ")}”`;
  }

  try {
    const existing = await findOpenRequest(subject);
    const number = existing ?? (await createRequest(subject, title, details));
    return Response.json({ number, existing: Boolean(existing) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
