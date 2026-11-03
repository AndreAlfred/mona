"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { exportState, importState, useDevice, type Entry } from "@/lib/store";
import styles from "./Pages.module.css";

function Tile({ e, share }: { e: Entry; share?: boolean }) {
  async function doShare() {
    const url = `${location.origin}/${e.key}`;
    const text = `${e.title} — ${e.artist}`;
    if (navigator.share) await navigator.share({ title: text, text, url }).catch(() => {});
    else await navigator.clipboard.writeText(url);
  }
  return (
    <li>
      <Link href={`/${e.key}`}>
        <div className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.thumb.replace(/\/full\/\d+,\//, "/full/400,/")} alt="" loading="lazy" />
        </div>
        <div className={styles.gtitle}>{e.title}</div>
        <div className={styles.gmeta}>
          {e.artist}
          {e.date ? `, ${e.date}` : ""}
        </div>
      </Link>
      {share && (
        <button className={`${styles.share} smallcaps`} onClick={doShare}>
          Share
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
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <p className={`${styles.kicker} smallcaps`}>Yours</p>
        <h1 className={styles.h1}>Collection</h1>
        <p className={styles.sub}>
          {!mounted ? "" : items.length ? `${items.length} ${items.length === 1 ? "work" : "works"} collected.` : "Nothing collected yet. Tap ◇ Collect on any work."}
        </p>
      </header>
      {mounted && (
        <ul className={styles.grid}>
          {items.map((e) => (
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
  const days = new Map<string, Entry[]>();
  for (const e of items) {
    const d = new Date(e.at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    days.set(d, [...(days.get(d) ?? []), e]);
  }
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <p className={`${styles.kicker} smallcaps`}>Yours</p>
        <h1 className={styles.h1}>History</h1>
        <p className={styles.sub}>{mounted ? `${items.length} works seen.` : ""}</p>
      </header>
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
