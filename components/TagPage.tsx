"use client";
import { useEffect, useState } from "react";
import { archiveCard, curatedCard, type CardModel } from "@/lib/cards";
import { getArtist, getCatalog, getTagWorks, getWork, knownArtistNames } from "@/lib/client-data";
import type { Tag } from "@/lib/schema";
import { normName } from "@/lib/util";
import { Passage } from "./Passage";
import { ResearchButton } from "./ResearchButton";
import { WorkCard } from "./WorkCard";
import { Loading, Seen } from "./Feed";
import styles from "./Pages.module.css";

const PAGE = 6;

export function TagPage({ id, term }: { id: string; term?: string }) {
  const [tag, setTag] = useState<Tag | null | undefined>(undefined);
  const [cards, setCards] = useState<CardModel[] | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    (async () => {
      const catalog = await getCatalog();
      const t = catalog.tags[id] ?? null;
      setTag(t);
      const curatedIds = Object.values(catalog.works).filter((w) => w.tags.includes(id)).map((w) => w.id);
      const curated = await Promise.all(
        curatedIds.map(async (wid) => {
          const w = await getWork(wid);
          return curatedCard(w, await getArtist(w.artist), catalog);
        }),
      );
      const q = t?.archiveTerm ?? term ?? t?.name ?? id.replace(/-/g, " ");
      const [archive, known] = await Promise.all([getTagWorks(q), knownArtistNames()]);
      const taken = new Set(curated.flatMap((c) => c.key));
      const arch = archive
        .filter((w) => !taken.has(`a/${w.key}`))
        .map((w) => archiveCard(w, undefined, known.get(normName(w.artistName)) ?? known.get(w.artistName.toLowerCase()) ?? "", { tags: catalog.tags }))
        .map((c) => (c.artist.key ? c : { ...c, artist: { ...c.artist, href: `/a/${c.key.slice(2)}` } }));
      setCards([...curated, ...arch]);
    })();
  }, [id, term]);

  const name = tag?.name ?? term ?? id.replace(/-/g, " ");
  return (
    <>
      <header className={styles.intro}>
        <p className={`${styles.kicker} smallcaps`}>{tag ? tag.kind : "Thread · from the archive"}</p>
        <h1 className={styles.h1}>{name.charAt(0).toUpperCase() + name.slice(1)}</h1>
        {tag?.summary.map((p, i) => <Passage key={i} p={p} />)}
        {!tag && <ResearchButton subject={{ type: "tag", key: id, label: "this thread" }} />}
      </header>
      {!cards ? (
        <Loading />
      ) : cards.length === 0 ? (
        <p className={styles.empty}>No works found for this thread yet.</p>
      ) : (
        <>
          {cards.slice(0, shown).map((c, i) => (
            <Seen key={c.key} card={c}>
              <WorkCard card={c} position={`${i + 1} of ${cards.length} · ${name}`} />
            </Seen>
          ))}
          {shown < cards.length && (
            <p className={styles.onward}>
              <button className="smallcaps" onClick={() => setShown((s) => s + PAGE)}>
                Show more
              </button>
            </p>
          )}
        </>
      )}
    </>
  );
}
