"use client";
import { useState } from "react";
import type { CardModel } from "@/lib/cards";
import { toggleCollected, useDevice } from "@/lib/store";
import styles from "./CardActions.module.css";

export function entryFor(card: CardModel) {
  return { key: card.key, title: card.title, artist: card.artist.name, date: card.date, thumb: card.image.url };
}

export function CardActions({ card }: { card: CardModel }) {
  const collected = useDevice((s) => s.collection.some((c) => c.key === card.key));
  const [shared, setShared] = useState<string | null>(null);

  async function share() {
    const url = `${location.origin}/${card.key}`;
    const text = `${card.title} — ${card.artist.name}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: text, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared("Link copied");
    } catch {
      /* dismissed */
    }
    setTimeout(() => setShared(null), 1800);
  }

  return (
    <div className={`${styles.actions} smallcaps`}>
      <button
        className={styles.collect}
        data-on={collected}
        aria-pressed={collected}
        onClick={() => toggleCollected(entryFor(card))}
      >
        <span className={styles.glyph} aria-hidden>
          {collected ? "◆" : "◇"}
        </span>
        {collected ? "Collected" : "Collect"}
      </button>
      <button onClick={share}>{shared ?? "Share"}</button>
    </div>
  );
}
