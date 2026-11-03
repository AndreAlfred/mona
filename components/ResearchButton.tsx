"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ResearchSubject } from "@/lib/cards";
import { freshCatalog } from "@/lib/client-data";
import { update, useDevice } from "@/lib/store";
import styles from "./ResearchButton.module.css";

type Status = "idle" | "asking" | "sending" | "queued" | "researching" | "publishing" | "done" | "failed" | "error";

/** Find the curated record that now covers this subject, if it has deployed. */
async function landed(subject: ResearchSubject): Promise<string | null> {
  const c = await freshCatalog();
  if (subject.type === "work") {
    const [src, n] = subject.key.split("-");
    const w = Object.values(c.works).find((w) => w.archive?.[src as "aic" | "cma"] === Number(n));
    return w ? `/w/${w.id}` : null;
  }
  if (subject.type === "artist") {
    const a = Object.values(c.artists).find((a) => a.id === subject.key && a.workIds.length);
    return a ? `/artist/${a.id}` : null;
  }
  return c.tags[subject.key] ? `/tag/${subject.key}` : null;
}

export function ResearchButton({ subject, onLanded }: { subject: ResearchSubject; onLanded?: () => void }) {
  const id = `${subject.type}:${subject.key}`;
  const issue = useDevice((s) => s.requests[id]);
  const passphrase = useDevice((s) => s.passphrase);
  const [status, setStatus] = useState<Status>(issue ? "queued" : "idle");
  const [href, setHref] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!issue) return;
    let stop = false;
    async function tick() {
      try {
        const r = await fetch(`/api/requests/${issue}`, { cache: "no-store" }).then((r) => r.json());
        if (stop) return;
        if (r.state === "failed") return setStatus("failed");
        if (r.state === "done") {
          const to = await landed(subject);
          if (to) {
            setHref(to);
            setStatus("done");
            onLanded?.();
            return;
          }
          setStatus("publishing");
        } else setStatus(r.state);
      } catch {
        /* offline; try again later */
      }
      if (!stop) timer = setTimeout(tick, 25_000);
    }
    let timer = setTimeout(tick, 400);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue]);

  async function send(pass: string) {
    setStatus("sending");
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: subject.type, key: subject.key, passphrase: pass }),
    });
    if (res.status === 401) {
      update((s) => ({ ...s, passphrase: undefined }));
      setStatus("asking");
      return;
    }
    if (!res.ok) return setStatus("error");
    const { number } = await res.json();
    update((s) => ({ ...s, passphrase: pass, requests: { ...s.requests, [id]: number } }));
    setStatus("queued");
  }

  const label: Record<Status, string> = {
    idle: `Research ${subject.label}`,
    asking: "",
    sending: "Sending…",
    queued: "Queued for research",
    researching: "Researching…",
    publishing: "Curated · publishing…",
    done: "Curated",
    failed: "Research couldn’t verify enough sources",
    error: "Couldn’t send · try again",
  };

  if (status === "asking") {
    return (
      <form
        className={styles.ask}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) send(draft.trim());
        }}
      >
        <input
          aria-label="Shared passphrase"
          placeholder="passphrase"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
        />
        <button type="submit" className="smallcaps">
          Send
        </button>
      </form>
    );
  }
  if (status === "done" && href) {
    return (
      <Link href={href} className={`${styles.button} ${styles.done} smallcaps`}>
        Read the curated card →
      </Link>
    );
  }
  const busy = status !== "idle" && status !== "error";
  return (
    <button
      className={`${styles.button} smallcaps`}
      data-busy={busy}
      disabled={busy}
      onClick={() => (passphrase ? send(passphrase) : setStatus("asking"))}
    >
      {busy && <span className={styles.pulse} aria-hidden />}
      {label[status]}
    </button>
  );
}
