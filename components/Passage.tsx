import type { Passage as P } from "@/lib/schema";
import { TIERS, type Tier } from "@/lib/schema";
import styles from "./Passage.module.css";

export function Passage({ p, compact }: { p: P; compact?: boolean }) {
  if (p.kind === "ai") {
    return (
      <aside className={`${styles.ai} ${compact ? styles.compact : ""}`}>
        <span className={`${styles.aiLabel} smallcaps`}>Mona’s note · AI</span>
        <p>{p.text}</p>
      </aside>
    );
  }
  const s = p.source;
  const href = s.url ?? s.readAt;
  return (
    <figure className={`${styles.quote} ${compact ? styles.compact : ""}`}>
      {p.lead && <p className={styles.lead}>{p.lead}</p>}
      <blockquote cite={s.readAt}>
        <p>{p.text}</p>
      </blockquote>
      <figcaption className={styles.cite}>
        <span className={`${styles.tier} smallcaps`} data-tier={s.tier} title={`Source tier ${s.tier} of 7`}>
          {TIERS[s.tier as Tier]}
        </span>
        <span>
          {s.author}
          {", "}
          <a href={href} target="_blank" rel="noreferrer">
            <cite>{s.title}</cite>
          </a>
          {s.publisher && <>, {s.publisher}</>}
          {s.year && <>, {s.year}</>}
          {s.page && <>, p. {s.page}</>}
          {s.url && s.readAt !== s.url && (
            <>
              {" · "}
              <a href={s.readAt} target="_blank" rel="noreferrer">
                read here
              </a>
            </>
          )}
          {s.license && <span className={styles.license}> · {s.license}</span>}
        </span>
      </figcaption>
    </figure>
  );
}
