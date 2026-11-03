"use client";
/** Shared status logic for research requests (button, Requests page, masthead dot). */
import type { ResearchSubject } from "./cards";
import { freshCatalog } from "./client-data";
import { requestHref } from "./store";

export type ReqState = "queued" | "researching" | "publishing" | "done" | "failed";
export type ReqStatus = { state: ReqState; href?: string; title?: string; closedAt?: string | null };

/** Vercel needs a minute or two after the merge before new content is live. */
const PUBLISH_MS = 150_000;

export async function fetchRequestStatus(issue: number, subject: Pick<ResearchSubject, "type" | "key">): Promise<ReqStatus> {
  const r = await fetch(`/api/requests/${issue}`, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
  if (r.state !== "done") return { state: r.state, title: r.title };
  if (subject.type === "work") {
    // Done when the curated card for this work is in the deployed catalog.
    const c = await freshCatalog();
    const [src, n] = subject.key.split("-");
    const w = Object.values(c.works).find((w) =>
      src === "wd" ? w.archive?.wd === `Q${n}` : w.archive?.[src as "aic" | "cma"] === Number(n),
    );
    return w ? { state: "done", href: `/w/${w.id}`, title: r.title } : { state: "publishing", title: r.title };
  }
  const since = r.closedAt ? Date.now() - Date.parse(r.closedAt) : Infinity;
  return since < PUBLISH_MS
    ? { state: "publishing", title: r.title, closedAt: r.closedAt }
    : { state: "done", href: requestHref(`${subject.type}:${subject.key}`), title: r.title, closedAt: r.closedAt };
}

export function subjectOf(id: string): Pick<ResearchSubject, "type" | "key"> {
  const [type, key] = id.split(":");
  return { type: type as ResearchSubject["type"], key };
}
