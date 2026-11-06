"use client";
import { useEffect, useRef, useState } from "react";
import { ResearchButton } from "./ResearchButton";
import styles from "./EndOfArtist.module.css";

const MAX = 150; // px the tether can stretch, visually
const ARM = 0.6; // fraction of MAX that arms the release (about 210px of finger travel)
const SLACK = 80; // px: Android's address bar changes the window height as it shows and hides

/** Rubber-band easing: the further you pull, the less it gives. */
const stretch = (raw: number) => MAX * (1 - Math.exp(-Math.max(0, raw) / 230));

export function EndOfArtist({
  artist,
  artistKey,
  seen,
  canContinue,
  onContinue,
  onLeave,
  active,
}: {
  artist: string;
  artistKey: string;
  seen: { thumb: string; title: string }[];
  canContinue: boolean;
  onContinue: () => void;
  /** Resolves false if the next artist couldn't be loaded. */
  onLeave: () => Promise<boolean>;
  /** Only the last panel on the page listens for the pull. */
  active: boolean;
}) {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Loading the next works takes a moment; show it, and ignore repeat taps.
  const [continuing, setContinuing] = useState(false);
  useEffect(() => setContinuing(false), [canContinue]);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const armed = pull >= MAX * ARM;
  const ref = useRef<HTMLDivElement>(null);
  const left = useRef(false);

  // One way out for the pull and the button alike. It answers at once, and if
  // the next artist can't be reached it says so and lets you try again.
  const leaveRef = useRef<() => void>(() => {});
  leaveRef.current = () => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    setFailed(false);
    setPull(0);
    navigator.vibrate?.(12);
    onLeave()
      .catch(() => false)
      .then((ok) => {
        if (ok) return;
        left.current = false;
        setLeaving(false);
        setFailed(true);
      });
  };

  useEffect(() => {
    if (!active) return;
    // "At the end" means the panel's bottom is on screen, give or take the
    // address bar, rather than an exact match with the page height.
    const atBottom = () => {
      const r = ref.current?.getBoundingClientRect();
      const h = Math.max(window.innerHeight, window.visualViewport?.height ?? 0);
      return !!r && r.bottom <= h + SLACK;
    };
    let startY: number | null = null;
    let raw = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;

    const onStart = (e: TouchEvent) => {
      startY = atBottom() && !left.current ? e.touches[0].clientY : null;
      raw = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      raw = startY - e.touches[0].clientY;
      if (raw <= 0) return setPull(0);
      if (e.cancelable) e.preventDefault();
      setDragging(true);
      setPull(stretch(raw));
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      setDragging(false);
      if (stretch(raw) >= MAX * ARM) leaveRef.current();
      else setPull(0);
    };
    // Trackpads and mouse wheels: keep scrolling past the end to stretch.
    const onWheel = (e: WheelEvent) => {
      if (left.current || !atBottom() || e.deltaY <= 0) return;
      raw += e.deltaY * 0.6;
      setPull(stretch(raw));
      clearTimeout(wheelTimer);
      if (stretch(raw) >= MAX * 0.97) return leaveRef.current();
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
  }, [active]);

  const hint = leaving
    ? "Finding someone new…"
    : failed
      ? "Mona couldn’t reach the next artist."
      : armed
        ? "Let go for someone new"
        : "Pull up for someone new";

  return (
    <section
      ref={ref}
      className={styles.panel}
      style={{ "--pull": `${pull}px`, "--t": pull / MAX } as React.CSSProperties}
      data-dragging={dragging}
      data-armed={armed || leaving}
      data-leaving={leaving}
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
      {/* Once you've moved on to another artist, this becomes a quiet summary. */}
      {active && (
        <div className={styles.more}>
          {canContinue ? (
            <button
              className={`${styles.stay} smallcaps`}
              data-busy={continuing}
              disabled={continuing || leaving}
              onClick={() => {
                setContinuing(true);
                onContinue();
              }}
            >
              {continuing ? "Finding more…" : `Keep going with ${artist}`}
            </button>
          ) : (
            <p className={styles.note}>That’s everything Mona has by {artist} for now.</p>
          )}
          <ResearchButton
            variant={canContinue ? "link" : "panel"}
            subject={{ type: "artist", key: artistKey, label: artist }}
            name={artist}
            cta={canContinue ? `Or ask our curator to find more by ${artist}` : undefined}
            meta={{ title: `More by ${artist}`, href: `/artist/${artistKey}`, thumb: seen[0]?.thumb }}
          />
        </div>
      )}

      <div className={styles.leave} hidden={!active}>
        <div className={styles.tether} aria-hidden>
          <span className={styles.line} />
          <span className={styles.knot} />
        </div>
        <p className={`${styles.hint} smallcaps`} aria-live="polite">
          {hint}
        </p>
        <button
          className={`${styles.next} smallcaps`}
          data-busy={leaving}
          disabled={leaving}
          onClick={() => leaveRef.current()}
        >
          {failed ? "Try again" : "Next artist"}
        </button>
      </div>
    </section>
  );
}

function numberWord(n: number) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] ?? String(n);
}
