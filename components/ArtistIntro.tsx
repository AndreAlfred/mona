"use client";
import { useEffect, useState } from "react";
import type { Artist } from "@/lib/schema";
import type { ArtistContext } from "@/lib/types";
import type { ArtistRef } from "@/lib/feed";
import { findArtist, getArtist, getArtistContext } from "@/lib/client-data";
import { PERIODS } from "@/lib/schema";
import { Passage } from "./Passage";
import { ResearchButton } from "./ResearchButton";
import { Feed } from "./Feed";
import styles from "./Pages.module.css";

export function ArtistPage({ id }: { id: string }) {
  const [ref, setRef] = useState<ArtistRef | null | undefined>(undefined);
  const [curated, setCurated] = useState<Artist | undefined>();
  const [ctx, setCtx] = useState<ArtistContext | undefined>();

  useEffect(() => {
    findArtist(id).then((r) => {
      setRef(r ?? null);
      if (!r) return;
      if (r.curated) getArtist(id).then(setCurated);
      else getArtistContext(r.name).then(setCtx);
    });
  }, [id]);

  if (ref === null) return <p className={styles.empty}>Mona doesn’t know this artist yet.</p>;
  if (!ref) return null;
  const period = PERIODS.find((p) => p.id === ref.period)?.name;
  const life = [ref.nationality, ref.born && `${ref.born}–${ref.died ?? ""}`, curated?.active && `active ${curated.active}`, period]
    .filter(Boolean)
    .join(" · ");
  const passages = curated ? curated.bio : [ctx?.summary, ...(ctx?.quotes.slice(0, 2) ?? [])].filter(Boolean);

  return (
    <>
      <header className={styles.intro}>
        <p className={`${styles.kicker} smallcaps`}>{ref.curated ? "Artist" : "Artist · from the archive"}</p>
        <h1 className={styles.h1}>{ref.name}</h1>
        <p className={`${styles.sub} smallcaps`}>{life}</p>
        {passages.map((p, i) => (
          <Passage key={i} p={p!} />
        ))}
        {!ref.curated && <ResearchButton subject={{ type: "artist", key: ref.key, label: "this artist" }} />}
      </header>
      <Feed only={id} />
    </>
  );
}
