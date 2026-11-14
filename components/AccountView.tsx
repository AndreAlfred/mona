"use client";
/**
 * Signing in keeps a reader's history, collection and place in the feed on
 * every browser they use. No password: Mona emails a 6-digit code, and only
 * to addresses Andrew has added.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDevice } from "@/lib/store";
import {
  accountsEnabled,
  deleteMyData,
  holdsSomeoneElses,
  linkDevice,
  requestCode,
  signOut,
  syncNow,
  useAccount,
  verifyCode,
  wakeAccounts,
  type CodeError,
} from "@/lib/sync";
import pages from "./Pages.module.css";
import styles from "./Account.module.css";

const RESEND_WAIT = 60;

const PROBLEM: Record<CodeError, string> = {
  "not-invited": "That address isn’t on Mona’s list yet. Ask Andrew to add you, then try again.",
  "too-soon": "Mona just sent a code. Wait a minute before asking for another.",
  "bad-code": "That code didn’t work. Check it, or ask for a new one (codes last ten minutes).",
  unreachable: "Mona couldn’t reach accounts just now. Check your connection and try again in a minute.",
};

type Step = { at: "email" } | { at: "code"; email: string };

export function AccountView() {
  const { ready, session } = useAccount();
  const syncedUser = useDevice((s) => s.syncedUser);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>({ at: "email" });

  useEffect(() => {
    setMounted(true);
    wakeAccounts();
  }, []);

  // Signed in, but this phone's saved history belongs to another account.
  const mismatch = session && syncedUser && syncedUser !== session.user.id && holdsSomeoneElses(session.user.id);

  let body: React.ReactNode = null;
  let sub = "";
  if (!mounted || !ready) body = null;
  else if (!accountsEnabled) {
    sub = "Accounts aren’t switched on yet. Your history and collection are saved on this phone.";
  } else if (session && mismatch) {
    sub = "One more thing before you’re signed in.";
    body = <Replace userId={session.user.id} />;
  } else if (session) {
    sub = "Your history, collection and place in the feed are kept in your account and on this phone.";
    body = <SignedIn email={session.user.email ?? ""} />;
  } else if (step.at === "code") {
    sub = "Mona has emailed you a 6-digit code.";
    body = (
      <CodeStep
        email={step.email}
        onBack={() => setStep({ at: "email" })}
        // Signing in starts a sync on its own (lib/sync.ts), unless this phone
        // holds someone else's history, which the screen above asks about first.
        onSignedIn={() => setStep({ at: "email" })}
      />
    );
  } else {
    sub = "Keep your history and collection on every phone and browser you use. No password: Mona emails you a code.";
    body = <EmailStep onSent={(email) => setStep({ at: "code", email })} />;
  }

  return (
    <div className={pages.page}>
      <header className={pages.intro}>
        <p className={`${pages.kicker} smallcaps`}>Yours</p>
        <h1 className={pages.h1}>Account</h1>
        <p className={pages.sub}>{sub}</p>
      </header>
      <div className={styles.desk}>{body}</div>
      {mounted && ready && (
        <p className={`${styles.back} smallcaps`}>
          <Link href="/history">History</Link>
          <Link href="/collection">Collection</Link>
        </p>
      )}
    </div>
  );
}

function EmailStep({ onSent }: { onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CodeError | null>(null);
  return (
    <form
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        const address = email.trim().toLowerCase();
        if (!address) return;
        setBusy(true);
        setProblem(null);
        const err = await requestCode(address);
        setBusy(false);
        if (err) setProblem(err);
        else onSent(address);
      }}
    >
      <label className={styles.field}>
        <span className={`${styles.label} smallcaps`}>Your email</span>
        <input
          className={styles.input}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {problem && (
        <p className={styles.problem} role="alert">
          {PROBLEM[problem]}
        </p>
      )}
      <button className={`${styles.primary} smallcaps`} disabled={busy}>
        {busy ? "Sending…" : "Email me a code"}
      </button>
    </form>
  );
}

function CodeStep({ email, onBack, onSignedIn }: { email: string; onBack: () => void; onSignedIn: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CodeError | null>(null);
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const wait = Math.max(0, RESEND_WAIT - Math.floor((now - sentAt) / 1000));

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!wait) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait]);

  async function submit(value: string) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const r = await verifyCode(email, value);
    setBusy(false);
    if ("error" in r) {
      setProblem(r.error);
      input.current?.select();
    } else onSignedIn();
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length >= 6) void submit(code);
      }}
    >
      <p className={styles.note}>
        Sent to <span className={styles.address}>{email}</span>. It can take a minute to arrive; check your spam folder if it doesn’t.
      </p>
      <label className={styles.field}>
        <span className={`${styles.label} smallcaps`}>Code</span>
        <input
          ref={input}
          className={`${styles.input} ${styles.code}`}
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={10}
          value={code}
          aria-describedby="code-help"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 10);
            setCode(v);
            // A pasted or autofilled code signs straight in.
            if (v.length === 6 && code.length < 5) void submit(v);
          }}
        />
      </label>
      {problem && (
        <p className={styles.problem} role="alert">
          {PROBLEM[problem]}
        </p>
      )}
      <button className={`${styles.primary} smallcaps`} disabled={busy || code.length < 6}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      <p id="code-help" className={`${styles.row} ${styles.minor}`}>
        <button
          type="button"
          className={`${styles.quiet} smallcaps`}
          disabled={wait > 0 || busy}
          onClick={async () => {
            setProblem(null);
            const err = await requestCode(email);
            if (err) setProblem(err);
            setSentAt(Date.now());
            setNow(Date.now());
            setCode("");
          }}
        >
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </button>
        <button type="button" className={`${styles.quiet} smallcaps`} onClick={onBack}>
          Use a different email
        </button>
      </p>
    </form>
  );
}

function Replace({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={styles.form}>
      <p className={styles.note}>
        This phone has history saved by someone else’s account. Signing in replaces it on this phone with yours. Theirs stays in
        their account, and comes back when they sign in again.
      </p>
      <p className={styles.row}>
        <button
          className={`${styles.primary} smallcaps`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            linkDevice(userId);
            void syncNow();
          }}
        >
          Replace and sign in
        </button>
        <button className={`${styles.quiet} smallcaps`} disabled={busy} onClick={() => void signOut()}>
          Cancel
        </button>
      </p>
    </div>
  );
}

function ago(t: number, now: number) {
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function SignedIn({ email }: { email: string }) {
  const { status } = useAccount();
  const syncedAt = useDevice((s) => s.syncedAt);
  const seen = useDevice((s) => s.history.length);
  const kept = useDevice((s) => s.collection.length);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState<"no" | "busy" | "failed">("no");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [syncedAt]);

  const line =
    status === "syncing"
      ? "Syncing…"
      : status === "unreachable"
        ? "Can’t reach your account right now. Everything is still saved on this phone, and Mona will try again."
        : syncedAt
          ? `Synced ${ago(syncedAt, now)}`
          : "Not synced yet";

  return (
    <>
      <section className={styles.ticket} aria-label="Signed in">
        <p className={`${styles.label} smallcaps`}>Signed in as</p>
        <p className={styles.address}>{email}</p>
        <p className={styles.status} data-status={status} aria-live="polite">
          <span className={styles.dot} aria-hidden />
          {line}
        </p>
        <p className={styles.counts}>
          {seen} {seen === 1 ? "work" : "works"} seen · {kept} collected
        </p>
      </section>
      <p className={styles.row}>
        <button className={`${styles.primary} smallcaps`} disabled={status === "syncing"} onClick={() => void syncNow()}>
          Sync now
        </button>
        <button className={`${styles.quiet} smallcaps`} onClick={() => void signOut()}>
          Sign out
        </button>
      </p>
      <p className={styles.minor}>Signing out keeps everything on this phone. It just stops syncing.</p>

      <section className={styles.danger}>
        {!confirm ? (
          <button className={`${styles.quiet} smallcaps`} onClick={() => setConfirm(true)}>
            Delete my saved data
          </button>
        ) : (
          <>
            <p className={styles.note}>
              This deletes your history, collection and place in the feed from your account and from this phone, then signs you
              out. Your other devices clear theirs the next time they open Mona. It can’t be undone.
            </p>
            {deleting === "failed" && (
              <p className={styles.problem} role="alert">
                Mona couldn’t reach your account, so nothing was deleted. Try again in a minute.
              </p>
            )}
            <p className={styles.row}>
              <button
                className={`${styles.primary} ${styles.destroy} smallcaps`}
                disabled={deleting === "busy"}
                onClick={async () => {
                  setDeleting("busy");
                  setDeleting((await deleteMyData()) ? "no" : "failed");
                }}
              >
                {deleting === "busy" ? "Deleting…" : "Delete everything"}
              </button>
              <button className={`${styles.quiet} smallcaps`} onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </p>
          </>
        )}
      </section>
    </>
  );
}
