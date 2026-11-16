"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { shareWork } from "@/lib/browser";
import { exportState, importState, useDevice, type Entry } from "@/lib/store";
import { normName } from "@/lib/util";
import { accountsEnabled, useAccount } from "@/lib/sync";
import styles from "./Pages.module.css";

/** Where this shelf is kept, and the way to an account. Hidden while accounts are off. */
function KeptLine() {
  const { ready, session } = useAccount();
  const syncedUser = useDevice((s) => s.syncedUser);
  const mounted = useMounted();
  if (!accountsEnabled || !mounted || !ready) return null;
  if (session && syncedUser === session.user.id)
    return (
      <p className={styles.kept}>
        Kept in your account. <Link href="/account">Account</Link>
      </p>
    );
  return (
    <p className={styles.kept}>
      Saved on this phone only. <Link href="/account">Sign in to keep it on any device</Link>
    </p>
  );
}

/** A shelf this long gets a field to find things in. */
const FIND_FROM = 12;

/**
 * Narrow a shelf to the entries that mention every word typed, in the title,
 * artist or date. Accents and capitals don't matter: "durer" finds Dürer.
 */
function useFind(items: Entry[]) {
  const [query, setQuery] = useState("");
  const words = normName(query).split(" ").filter(Boolean);
  const found = words.length
    ? items.filter((e) => {
        const text = normName(`${e.title} ${e.artist} ${e.date ?? ""}`);
        return words.every((w) => text.includes(w));
      })
    : items;
  const field = items.length >= FIND_FROM && (
    <label className={styles.find}>
      <span className="visually-hidden">Find a work or artist</span>
      <input
        type="search"
        placeholder="Find a work or artist"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </label>
  );
  const none = words.length > 0 && !found.length && <p className={styles.none}>Nothing here matches “{query.trim()}”.</p>;
  return { found, finding: words.length > 0, field, none };
}

function Tile({ e, share }: { e: Entry; share?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function doShare() {
    if ((await shareWork(e)) !== "copied") return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <li>
      <Link href={`/${e.key}`}>
        <div className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={e.thumb.replace(/\/\d+px-/, "/500px-")}
            alt=""
            loading="lazy"
            onError={(ev) => (ev.currentTarget.style.visibility = "hidden")}
          />
        </div>
        <div className={styles.gtitle}>{e.title}</div>
        <div className={styles.gmeta}>
          {e.artist}
          {e.date ? `, ${e.date}` : ""}
        </div>
      </Link>
      {share && (
        <button className={`${styles.share} smallcaps`} onClick={doShare}>
          {copied ? "Link copied" : "Share"}
        </button>
      )}
    </li>
  );
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function CollectionView() {
  const items = useDevice((s) => s.collection);
  const mounted = useMounted();
  const { found, finding, field, none } = useFind(items);
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <p className={`${styles.kicker} smallcaps`}>Yours</p>
        <h1 className={styles.h1}>Collection</h1>
        <p className={styles.sub}>
          {!mounted
            ? ""
            : finding
              ? `${found.length} of ${items.length} works collected.`
              : items.length
                ? `${items.length} ${items.length === 1 ? "work" : "works"} collected.`
                : "Nothing collected yet. Tap ◇ Collect on any work."}
        </p>
        <KeptLine />
        {mounted && field}
      </header>
      {mounted && none}
      {mounted && (
        <ul className={styles.grid}>
          {found.map((e) => (
            <Tile key={e.key} e={e} share />
          ))}
        </ul>
      )}
      <Tools />
    </div>
  );
}

export function HistoryView() {
  const items = useDevice((s) => s.history);
  const mounted = useMounted();
  const { found, finding, field, none } = useFind(items);
  const days = new Map<string, Entry[]>();
  for (const e of found) {
    const d = new Date(e.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    days.set(d, [...(days.get(d) ?? []), e]);
  }
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <p className={`${styles.kicker} smallcaps`}>Yours</p>
        <h1 className={styles.h1}>History</h1>
        <p className={styles.sub}>
          {!mounted ? "" : finding ? `${found.length} of ${items.length} works seen.` : `${items.length} works seen.`}
        </p>
        <KeptLine />
        {mounted && field}
      </header>
      {mounted && none}
      {mounted &&
        [...days].map(([day, list]) => (
          <section key={day}>
            <h2 className={styles.day}>{day}</h2>
            <ul className={styles.grid}>
              {list.map((e) => (
                <Tile key={e.key} e={e} />
              ))}
            </ul>
          </section>
        ))}
      <Tools />
    </div>
  );
}

/** Export/import, so a lost phone or cleared browser doesn't lose a collection. */
function Tools() {
  const [msg, setMsg] = useState<string | null>(null);
  function download() {
    const blob = new Blob([exportState()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mona-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className={`${styles.tools} smallcaps`}>
      <button onClick={download}>Export my Mona</button>
      <label>
        Import
        <input
          type="file"
          accept="application/json"
          className="visually-hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              importState(await f.text());
              setMsg("Imported.");
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        />
      </label>
      {msg && <span>{msg}</span>}
    </div>
  );
}
