"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchRequestStatus, subjectOf } from "@/lib/requests";
import { getState, useDevice } from "@/lib/store";
import styles from "./Masthead.module.css";

/** "Requests" in the masthead, with a dot when something you asked for is ready. */
export function RequestsLink() {
  const requests = useDevice((s) => s.requests);
  const seen = useDevice((s) => s.seenDone);
  const [ready, setReady] = useState<string[]>([]);

  useEffect(() => {
    let stop = false;
    const seenNow = new Set(getState().seenDone ?? []);
    const pending = Object.entries(requests).filter(([id, n]) => !seenNow.has(`${id}#${n}`)).slice(0, 12);
    Promise.all(
      pending.map(([id, n]) =>
        fetchRequestStatus(n, subjectOf(id))
          .then((s) => (s.state === "done" ? `${id}#${n}` : null))
          .catch(() => null),
      ),
    ).then((r) => !stop && setReady(r.filter(Boolean) as string[]));
    return () => {
      stop = true;
    };
  }, [requests]);

  const dot = ready.some((k) => !(seen ?? []).includes(k));
  return (
    <Link href="/requests" className={styles.requests}>
      Requests
      {dot && <span className={styles.dot} aria-label="something you requested is ready" />}
    </Link>
  );
}
