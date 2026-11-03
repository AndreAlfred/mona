"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./EndOfArtist.module.css";

const MAX = 150; // px the tether can stretch, visually
const ARM = 0.74; // fraction of MAX that arms the release

/** Rubber-band easing: the further you pull, the less it gives. */
const stretch = (raw: number) => MAX * (1 - Math.exp(-Math.max(0, raw) / 230));

export function EndOfArtist({
  artist,
  seen,
  canContinue,
  onContinue,
  onLeave,
  active,
}: {
  artist: string;
  seen: { thumb: string; title: string }[];
  canContinue: boolean;
  onContinue: () => void;
  onLeave: () => void;
  /** Only the last panel on the page listens for the pull. */
  active: boolean;
}) {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const armed = pull >= MAX * ARM;
  const ref = useRef<HTMLDivElement>(null);
  const left = useRef(false);

  useEffect(() => {
    if (!active) return;
    const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let startY: number | null = null;
    let raw = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      if (left.current) return;
      left.current = true;
      navigator.vibrate?.(12);
      onLeave();
    };
    const onStart = (e: TouchEvent) => {
      startY = atBottom() ? e.touches[0].clientY : null;
      raw = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      raw = startY - e.touches[0].clientY;
      if (raw <= 0) return setPull(0);
      e.preventDefault();
      setDragging(true);
      setPull(stretch(raw));
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      setDragging(false);
      if (stretch(raw) >= MAX * ARM) fire();
      else setPull(0);
    };
    // Trackpads and mouse wheels: keep scrolling past the end to stretch.
    const onWheel = (e: WheelEvent) => {
      if (!atBottom() || e.deltaY <= 0) return;
      raw += e.deltaY * 0.6;
      setPull(stretch(raw));
      clearTimeout(wheelTimer);
      if (stretch(raw) >= MAX * 0.97) return fire();
      wheelTimer = setTimeout(() => {
        raw = 0;
        setPull(0);
      }, 260);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("wheel", onWheel);
      clearTimeout(wheelTimer);
    };
  }, [active, onLeave]);

  return (
    <section
      ref={ref}
      className={styles.panel}
      style={{ "--pull": `${pull}px`, "--t": pull / MAX } as React.CSSProperties}
      data-dragging={dragging}
      data-armed={armed}
    >
      <p className={`${styles.kicker} smallcaps`}>End of this run</p>
      <h2 className={styles.title}>
        You’ve spent {seen.length === 1 ? "one work" : `${numberWord(seen.length)} works`} with {artist}.
      </h2>
      <ul className={styles.strip} aria-label="Works in this run">
        {seen.map((s, i) => (
          <li key={i} style={{ animationDelay: `${i * 45}ms` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.thumb} alt={s.title} loading="lazy" />
          </li>
        ))}
      </ul>
      {canContinue ? (
        <button className={`${styles.stay} smallcaps`} onClick={onContinue}>
          Keep going with {artist}
        </button>
      ) : (
        <p className={styles.note}>That’s everything Mona has by {artist} for now.</p>
      )}

      <div className={styles.leave} aria-live="polite">
        <div className={styles.tether} aria-hidden>
          <span className={styles.line} />
          <span className={styles.knot} />
        </div>
        <p className={`${styles.hint} smallcaps`}>
          {armed ? "Let go for someone new" : "Pull past here to leave for a new artist"}
        </p>
        <button className={`${styles.hold} smallcaps`} onClick={onLeave}>
          or tap here to leave
        </button>
      </div>
    </section>
  );
}

function numberWord(n: number) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] ?? String(n);
}
