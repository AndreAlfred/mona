"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ResearchSubject } from "@/lib/cards";
import { fetchRequestStatus, type ReqState } from "@/lib/requests";
import { recordRequest, update, useDevice } from "@/lib/store";
import styles from "./ResearchButton.module.css";

type Status = "idle" | "asking" | "sending" | "error" | ReqState;

/**
 * Ask the curator (an agent) to research something. Requests are slow — a
 * few minutes to a day — so every state says to check back later, and the
 * Requests page lists them all.
 */
export function ResearchButton({
  subject,
  name,
  cta,
  meta,
  variant = "link",
  onLanded,
}: {
  subject: ResearchSubject;
  /** Who/what it's about, for the copy: "Georges Seurat", "this painting". */
  name: string;
  cta?: string;
  /** Shown on the Requests page. */
  meta: { title: string; href: string; thumb?: string };
  variant?: "panel" | "link";
  onLanded?: () => void;
}) {
  const id = `${subject.type}:${subject.key}`;
  const issue = useDevice((s) => s.requests[id]);
  const passphrase = useDevice((s) => s.passphrase);
  const [status, setStatus] = useState<Status>(issue ? "queued" : "idle");
  const [href, setHref] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!issue) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const r = await fetchRequestStatus(issue, subject);
        if (stop) return;
        setStatus(r.state);
        if (r.state === "done") {
          setHref(r.href ?? null);
          onLanded?.();
          return;
        }
        if (r.state === "failed") return;
      } catch {
        /* offline or not configured; try again later */
      }
      if (!stop) timer = setTimeout(tick, 25_000);
    }
    timer = setTimeout(tick, 300);
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
    recordRequest(id, number, { ...meta, at: Date.now() }, pass);
    setStatus("queued");
  }

  const isWork = subject.type === "work";
  const ask = () => (passphrase ? send(passphrase) : setStatus("asking"));
  const askLabel = cta ?? (isWork ? "Ask the curator about this painting" : `Ask our curator to find more by ${name}`);
  const later = isWork ? "Check back later for this painting." : `Check back later for more on ${name}.`;

  const message: Partial<Record<Status, string>> = {
    sending: "Sending to the curator…",
    queued: `Requested. ${later}`,
    researching: `The curator is working on it. ${later}`,
    publishing: "Curated. Publishing in a minute or two.",
    failed: "The curator couldn’t find enough verifiable sources this time.",
    error: "Couldn’t reach the curator. Try again.",
  };

  if (status === "asking") {
    return (
      <form
        className={`${styles.ask} ${variant === "panel" ? styles.panel : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) send(draft.trim());
        }}
      >
        <span className={`${styles.prompt} smallcaps`}>Shared passphrase</span>
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

  const busy = status === "sending" || status === "queued" || status === "researching" || status === "publishing";
  const canAsk = status === "idle" || status === "error" || status === "failed" || status === "done";
  const doneLink =
    status === "done" && href ? (
      <Link href={href} className={`${styles.done} smallcaps`}>
        {isWork ? "Read the curated card →" : `New works by ${name} are ready →`}
      </Link>
    ) : null;

  return (
    <div className={variant === "panel" ? styles.panel : styles.inline} aria-live="polite">
      {doneLink}
      {message[status] && (
        <p className={styles.message}>
          {busy && <span className={styles.pulse} aria-hidden />}
          {message[status]}
          {busy && variant === "panel" && (
            <>
              {" "}
              <Link href="/requests" className={styles.all}>
                Your requests
              </Link>
            </>
          )}
        </p>
      )}
      {canAsk && (
        <button className={`${variant === "panel" ? styles.cta : styles.button} smallcaps`} onClick={ask}>
          {status === "done" ? (isWork ? "Ask again" : `Ask for even more by ${name}`) : askLabel}
        </button>
      )}
    </div>
  );
}
