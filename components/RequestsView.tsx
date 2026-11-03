"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchRequestStatus, subjectOf, type ReqStatus } from "@/lib/requests";
import { markRequestsSeen, requestHref, useDevice } from "@/lib/store";
import styles from "./Pages.module.css";

const LABEL: Record<ReqStatus["state"], string> = {
  queued: "Requested · check back later",
  researching: "The curator is working on it",
  publishing: "Curated · publishing",
  done: "Ready",
  failed: "Couldn’t find enough verifiable sources",
};

const KIND: Record<string, string> = { work: "This painting", artist: "More by the artist", tag: "A thread" };

/** Everything this device has asked the curator for, newest first. */
export function RequestsView() {
  const requests = useDevice((s) => s.requests);
  const meta = useDevice((s) => s.requestMeta);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Record<string, ReqStatus>>({});
  const [unreachable, setUnreachable] = useState<string[]>([]);
  useEffect(() => setMounted(true), []);

  const items = useMemo(
    () =>
      Object.entries(requests)
        .map(([id, issue]) => ({ id, issue, meta: meta?.[id] }))
        .sort((a, b) => (b.meta?.at ?? b.issue) - (a.meta?.at ?? a.issue)),
    [requests, meta],
  );

  useEffect(() => {
    let stop = false;
    for (const it of items)
      fetchRequestStatus(it.issue, subjectOf(it.id))
        .then((s) => !stop && setStatus((m) => ({ ...m, [it.id]: s })))
        .catch(() => !stop && setUnreachable((u) => [...u, it.id]));
    return () => {
      stop = true;
    };
  }, [items]);

  // Opening this page counts as seeing whatever is ready.
  useEffect(() => {
    const ready = items.filter((it) => status[it.id]?.state === "done").map((it) => `${it.id}#${it.issue}`);
    if (ready.length) markRequestsSeen(ready);
  }, [items, status]);

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <p className={`${styles.kicker} smallcaps`}>Yours</p>
        <h1 className={styles.h1}>Requests</h1>
        <p className={styles.sub}>
          {!mounted
            ? ""
            : items.length
              ? "What you’ve asked the curator to find. Research takes anywhere from a few minutes to a day."
              : "Nothing requested yet. When an artist runs out, ask the curator to find more."}
        </p>
      </header>
      {mounted && (
        <ul className={styles.requests}>
          {items.map((it) => {
            const s = status[it.id];
            const title = it.meta?.title ?? s?.title ?? it.id.split(":")[1].replace(/-/g, " ");
            const href = (s?.state === "done" && s.href) || it.meta?.href || requestHref(it.id);
            return (
              <li key={it.id} className={styles.requestItem} data-state={s?.state ?? "loading"}>
                <Link href={href} className={styles.requestLink}>
                  {it.meta?.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.meta.thumb.replace(/\/\d+px-/, "/250px-")} alt="" className={styles.requestThumb} />
                  ) : (
                    <span className={styles.requestThumb} aria-hidden />
                  )}
                  <span>
                    <span className={`${styles.gmeta} smallcaps`}>{KIND[it.id.split(":")[0]]}</span>
                    <span className={styles.requestTitle}>{title}</span>
                    <span className={styles.requestState}>
                      {s ? LABEL[s.state] : unreachable.includes(it.id) ? "Couldn’t check on this right now" : "Checking…"}
                      {s?.state === "done" && " · see what’s new →"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
