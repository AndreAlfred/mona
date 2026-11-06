"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { archiveCard, curatedCard, type CardModel } from "@/lib/cards";
import {
  getArchiveWork,
  getArtist,
  getArtistContext,
  getCatalog,
  getUniverse,
  getWork,
  knownArtistNames,
} from "@/lib/client-data";
import { normName } from "@/lib/util";
import { WorkCard } from "./WorkCard";
import { Loading, Seen } from "./Feed";
import styles from "./Pages.module.css";

/** One card on its own: the target of shared links, collection and history. */
export function SingleCard({ kind, id }: { kind: "w" | "a"; id: string }) {
  const [card, setCard] = useState<CardModel | null>(null);
  const [missing, setMissing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      const catalog = await getCatalog();
      if (kind === "w") {
        const [w, a] = await Promise.all([getWork(id), getArtist(catalog.works[id]?.artist ?? "")]);
        return curatedCard(w, a, catalog);
      }
      // If this archive work has since been curated, show the curated card instead.
      const [src, n] = id.split("-");
      const curated = Object.values(catalog.works).find((w) => w.archive?.[src as "aic" | "cma"] === Number(n));
      if (curated) {
        const [w, a] = await Promise.all([getWork(curated.id), getArtist(curated.artist)]);
        return curatedCard(w, a, catalog);
      }
      const w = await getArchiveWork(id);
      const [ctx, known, universe] = await Promise.all([getArtistContext(w.artistName), knownArtistNames(), getUniverse()]);
      const artist = universe.find((a) => normName(a.name) === normName(w.artistName));
      return archiveCard(w, ctx, artist?.key ?? "", { knownArtists: known, tags: catalog.tags });
    })()
      .then((c) => {
        if (!c.artist.key) c.artist.href = "/";
        setCard(c);
      })
      .catch(() => setMissing(true));
  }, [kind, id, reload]);

  if (missing) return <p className={styles.empty}>This work couldn’t be found.</p>;
  if (!card) return <Loading />;
  return (
    <>
      {/* Shared links count as seen too, so they land in History. */}
      <Seen card={card}>
        <WorkCard card={card} eager onLanded={() => setReload((r) => r + 1)} />
      </Seen>
      <p className={styles.onward}>
        <Link href="/" className="smallcaps">
          Back to your feed
        </Link>
      </p>
    </>
  );
}
