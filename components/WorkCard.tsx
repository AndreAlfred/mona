"use client";
import Link from "next/link";
import { useState } from "react";
import type { CardModel } from "@/lib/cards";
import { Passage } from "./Passage";
import { CardActions } from "./CardActions";
import { ResearchButton } from "./ResearchButton";
import styles from "./WorkCard.module.css";

export function WorkCard({
  card,
  position,
  eager,
  onLanded,
}: {
  card: CardModel;
  position?: string;
  eager?: boolean;
  /** Called when a research request for this card has been curated. */
  onLanded?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const ratio = card.image.width && card.image.height ? card.image.width / card.image.height : undefined;
  const highlighted = card.tags.filter((t) => t.highlight?.length);

  return (
    <article className={styles.card} data-curated={card.curated}>
      <div className={styles.plate}>
        <a href={card.image.large ?? card.image.url} target="_blank" rel="noreferrer" aria-label={`Open full image of ${card.title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.image.url}
            srcSet={card.image.large && /artic\.edu/.test(card.image.large) ? `${card.image.url} 843w, ${card.image.large} 1686w` : undefined}
            sizes="(min-width: 960px) 55vw, 300px"
            alt={`${card.title} by ${card.artist.name}`}
            width={card.image.width}
            height={card.image.height}
            style={ratio ? { aspectRatio: String(ratio) } : undefined}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={eager ? "high" : "auto"}
            className={loaded ? styles.loaded : undefined}
            onLoad={() => setLoaded(true)}
          />
        </a>
      </div>

      <div className={styles.body}>
        <header className={styles.label}>
          {position && <p className={`${styles.position} smallcaps`}>{position}</p>}
          <h2 className={styles.artist}>
            <Link href={card.artist.href}>{card.artist.name}</Link>
          </h2>
          {card.artist.line && <p className={`${styles.life} smallcaps`}>{card.artist.line}</p>}
          <h3 className={styles.title}>
            <i>{card.title}</i>
            {card.date && <span className={styles.date}>, {card.date}</span>}
          </h3>
          {card.phase && (
            <p className={styles.phase}>
              {card.phase.label}
              {card.phase.source ? (
                <a className={`${styles.mark} smallcaps`} href={card.phase.source.url} target="_blank" rel="noreferrer" title={card.phase.source.label}>
                  source
                </a>
              ) : (
                <span className={`${styles.mark} ${styles.markAi} smallcaps`} title="Mona’s judgement (AI)">
                  AI
                </span>
              )}
            </p>
          )}
          <p className={styles.meta}>
            {[card.medium, card.dimensions].filter(Boolean).join(" · ")}
            {(card.medium || card.dimensions) && <br />}
            <a href={card.museum.url} target="_blank" rel="noreferrer">
              {card.museum.name}
            </a>
          </p>
          <CardActions card={card} />
        </header>

        {!card.curated && card.research && (
          <div className={styles.archive}>
            <span className="smallcaps">From the archive · not yet curated</span>
            <ResearchButton subject={card.research} onLanded={onLanded} />
          </div>
        )}

        {card.sections.map((s) => (
          <Section key={s.id} heading={s.heading} passages={s.passages} />
        ))}

        {highlighted.map((t) => (
          <section key={t.id} className={styles.highlight}>
            <h4 className="smallcaps">
              On <Link href={t.href}>{t.name}</Link>
            </h4>
            {t.highlight!.map((p, i) => (
              <Passage key={i} p={p} compact />
            ))}
          </section>
        ))}

        <Threads card={card} />
      </div>
    </article>
  );
}

function Section({ heading, passages }: { heading: string; passages: CardModel["sections"][number]["passages"] }) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = passages;
  return (
    <section className={styles.section}>
      <h4 className={`${styles.heading} smallcaps`}>{heading}</h4>
      <Passage p={first} />
      {rest.length > 0 &&
        (open ? (
          rest.map((p, i) => <Passage key={i} p={p} />)
        ) : (
          <button className={`${styles.more} smallcaps`} onClick={() => setOpen(true)}>
            Continue reading ({rest.length})
          </button>
        ))}
    </section>
  );
}

function Threads({ card }: { card: CardModel }) {
  const groups = [
    { label: "Techniques & materials", items: card.tags.map((t) => ({ name: t.name, href: t.href, ai: t.ai })) },
    { label: "Movement", items: card.movements.map((m) => ({ ...m, ai: false })) },
    { label: "Circle", items: card.peers.map((p) => ({ ...p, ai: false })) },
  ].filter((g) => g.items.length);
  return (
    <nav className={styles.threads} aria-label="Related">
      {groups.map((g) => (
        <div key={g.label} className={styles.thread}>
          <span className={`${styles.threadLabel} smallcaps`}>{g.label}</span>
          <span className={styles.threadItems}>
            {g.items.map((it, i) => (
              <span key={`${it.name}-${i}`}>
                {i > 0 && <span className={styles.dot}> · </span>}
                {it.href ? <Link href={it.href}>{it.name}</Link> : it.name}
                {it.ai && <sup className={`${styles.markAi} smallcaps`} title="Assigned by Mona (AI)"> ai</sup>}
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className={styles.thread}>
        <span className={`${styles.threadLabel} smallcaps`}>Go on</span>
        <span className={styles.threadItems}>
          <Link href={card.artist.href}>More by {card.artist.name}</Link>
        </span>
      </div>
    </nav>
  );
}
