"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { archiveCard, curatedCard, type CardModel } from "@/lib/cards";
import {
  getArchiveWorks,
  getArtist,
  getArtistContext,
  getCatalog,
  getUniverse,
  getWork,
  knownArtistNames,
} from "@/lib/client-data";
import { dedupeWorks, orderWorks, pickNextArtist, rng, RUN_LENGTH, type ArtistRef } from "@/lib/feed";
import { getState, markArtistVisited, recordSeen, setCurrent, update } from "@/lib/store";
import { entryFor } from "./CardActions";
import { EndOfArtist } from "./EndOfArtist";
import { WorkCard } from "./WorkCard";
import styles from "./Feed.module.css";

type Slot = { key: string; load: () => Promise<CardModel> };
type Run = { id: number; artist: ArtistRef; slots: Slot[]; remaining: number };

/**
 * Build the ordered list of works for an artist as lazy card loaders,
 * leaving out anything in `exclude` (history and what this session has
 * already shown) and duplicate records of the same picture.
 */
async function slotsFor(artist: ArtistRef, exclude: Set<string>): Promise<Slot[]> {
  const catalog = await getCatalog();
  const curatedIds = catalog.artists[artist.key]?.workIds ?? [];
  const curated = curatedIds.map((id) => ({
    key: `w/${id}`,
    title: catalog.works[id]?.title ?? id,
    archive: catalog.works[id]?.archive,
    load: async () => {
      const [w, a] = await Promise.all([getWork(id), getArtist(artist.key)]);
      return curatedCard(w, a, catalog);
    },
  }));
  const archiveWorks = await getArchiveWorks(artist);
  const archive = archiveWorks.map((w, i) => ({
    key: `a/${w.key}`,
    title: w.title,
    load: async () => {
      const [ctx, known] = await Promise.all([getArtistContext(w.artistName), knownArtistNames()]);
      return archiveCard(w, ctx, artist.key, { index: i, knownArtists: known, tags: catalog.tags });
    },
  }));
  // Dedupe across everything first, so a second print of a work you've already seen is caught too.
  return dedupeWorks(orderWorks(curated, archive, new Set())).filter((x) => !exclude.has(x.key));
}

let runIds = 0;

export function Feed({ only }: { only?: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);

  // Every work put on the page this session, so nothing appears twice even if
  // it scrolled past too fast to be recorded in history.
  const shown = useRef(new Set<string>());
  const startRun = useCallback(
    async (artist: ArtistRef, continuing: boolean, shownAlready = 0) => {
      // The home feed skips what you've seen before; an artist's own page shows everything once.
      const exclude = new Set(shown.current);
      if (!only) for (const h of getState().history) exclude.add(h.key);
      const slots = await slotsFor(artist, exclude);
      if (!slots.length) return null;
      const take = Math.max(1, RUN_LENGTH - shownAlready);
      if (!only) {
        markArtistVisited(artist.key, artist.period);
        if (!continuing || shownAlready === 0) setCurrent({ artist: artist.key, shown: shownAlready });
      }
      const picked = slots.slice(0, take);
      picked.forEach((s) => shown.current.add(s.key));
      return { id: ++runIds, artist, slots: picked, remaining: Math.max(0, slots.length - take) } as Run;
    },
    [only],
  );

  const nextArtist = useCallback(async (): Promise<Run | null> => {
    const universe = await getUniverse();
    const r = rng(getState().seed + getState().visitedArtists.length * 7919);
    for (let tries = 0; tries < 8; tries++) {
      const s = getState();
      const a = pickNextArtist(universe, s.visitedArtists, s.lastPeriod, r);
      if (!a) return null;
      const run = await startRun(a, false).catch(() => null);
      if (run) return run;
      markArtistVisited(a.key); // nothing unseen; skip it
    }
    return null;
  }, [startRun]);

  // First run: resume an unfinished artist, or start someone new.
  useEffect(() => {
    if (starting.current) return;
    starting.current = true;
    (async () => {
      try {
        const universe = await getUniverse();
        let run: Run | null = null;
        if (only) {
          const a = universe.find((x) => x.key === only);
          if (a) run = await startRun(a, true);
        } else {
          const cur = getState().current;
          const a = cur && cur.shown < RUN_LENGTH ? universe.find((x) => x.key === cur.artist) : undefined;
          if (a && cur) run = await startRun(a, true, cur.shown);
          run ??= await nextArtist();
        }
        if (run) setRuns([run]);
        else setError(only ? "Nothing more to show here yet." : "Mona couldn’t reach the collections. Check your connection and try again.");
      } catch {
        setError("Mona couldn’t reach the collections. Check your connection and try again.");
      }
    })();
  }, [only, startRun, nextArtist]);

  // "Keep going" extends the same run in place: the end panel gives way and
  // the next works carry on right where it was.
  const keepGoing = useCallback(
    async (run: Run) => {
      const next = await startRun(run.artist, true, 0);
      if (!next) {
        setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, remaining: 0 } : r)));
        return;
      }
      setRuns((rs) =>
        rs.map((r) => (r.id === run.id ? { ...r, slots: [...r.slots, ...next.slots], remaining: next.remaining } : r)),
      );
    },
    [startRun],
  );

  const leave = useCallback(async () => {
    if (only) {
      window.location.href = "/";
      return;
    }
    const next = await nextArtist();
    if (!next) return;
    setRuns((rs) => [...rs.slice(-1), next]);
    requestAnimationFrame(() =>
      document.getElementById(`run-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [nextArtist, only]);

  if (error) return <p className={styles.empty}>{error}</p>;
  if (!runs.length) return <Loading />;

  return (
    <div className={styles.feed}>
      {runs.map((run, ri) => (
        <RunView
          key={run.id}
          run={run}
          last={ri === runs.length - 1}
          onContinue={() => keepGoing(run)}
          onLeave={leave}
        />
      ))}
    </div>
  );
}

function RunView({
  run,
  last,
  onContinue,
  onLeave,
}: {
  run: Run;
  last: boolean;
  onContinue: () => void;
  onLeave: () => void;
}) {
  const [cards, setCards] = useState<(CardModel | null)[]>([]);
  const [revealed, setRevealed] = useState(1);
  const sentinel = useRef<HTMLDivElement>(null);

  // Load cards a couple ahead of what's on screen. Each slot is requested once;
  // results land whenever they arrive, even if more slots were revealed meanwhile.
  const requested = useRef(new Set<number>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const want = Math.min(run.slots.length, revealed + 2);
    const set = (i: number, v: CardModel | null) =>
      setCards((c) => {
        const n = [...c];
        n[i] = v;
        return n;
      });
    run.slots.slice(0, want).forEach((slot, i) => {
      if (requested.current.has(i)) return;
      requested.current.add(i);
      set(i, null);
      slot
        .load()
        .then((card) => {
          if (!alive.current) return;
          set(i, card);
          const img = new Image();
          img.src = card.image.url; // warm the cache
        })
        .catch(() => alive.current && set(i, { failed: true } as unknown as CardModel));
    });
  }, [revealed, run]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => es.some((e) => e.isIntersecting) && setRevealed((r) => Math.min(run.slots.length, r + 1)),
      { rootMargin: "120% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [run.slots.length, revealed]);

  const shown = cards.slice(0, revealed).filter((c) => c && !(c as any).failed) as CardModel[];
  const done = revealed >= run.slots.length && cards.length >= run.slots.length && cards.every((c) => c !== null);

  return (
    <div id={`run-${run.id}`} className={styles.run}>
      {shown.map((card, i) => (
        <Seen key={card.key} card={card}>
          <WorkCard
            card={card}
            eager={i === 0}
            position={`${i + 1} of ${run.slots.length} · ${run.artist.name}`}
            onImageError={() =>
              setCards((c) => c.map((x) => (x?.key === card.key ? ({ failed: true } as unknown as CardModel) : x)))
            }
          />
        </Seen>
      ))}
      {!done && <div ref={sentinel} className={styles.sentinel}>{cards[revealed - 1] === null && <Loading small />}</div>}
      {done && (
        <EndOfArtist
          artist={run.artist.name}
          artistKey={run.artist.key}
          seen={shown.map((c) => ({ thumb: c.image.url, title: c.title }))}
          canContinue={run.remaining > 0}
          onContinue={onContinue}
          onLeave={onLeave}
          active={last}
        />
      )}
    </div>
  );
}

/** Records a card in history once it has been on screen for a moment. */
export function Seen({ card, children }: { card: CardModel; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer);
        if (e.isIntersecting)
          timer = setTimeout(() => {
            const already = getState().history.some((h) => h.key === card.key);
            recordSeen(entryFor(card));
            if (!already)
              update((s) =>
                s.current?.artist === card.artist.key ? { ...s, current: { ...s.current, shown: s.current.shown + 1 } } : s,
              );
            io.disconnect();
          }, 900);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [card]);
  return <div ref={ref}>{children}</div>;
}

export function Loading({ small }: { small?: boolean }) {
  return (
    <div className={small ? styles.loadingSmall : styles.loading} aria-label="Loading">
      <span />
    </div>
  );
}
