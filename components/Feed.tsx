"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

/** Run a loader at most once (retrying after a failure), so prefetching and rendering share one request. */
function once<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () =>
    (p ??= f().catch((e) => {
      p = undefined;
      throw e;
    }));
}

/** Download and decode an image ahead of time; gives up quietly after a few seconds. */
function warmImage(url: string, ms = 6000) {
  const img = new Image();
  img.src = url;
  return Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

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
    load: once(async () => {
      const [w, a] = await Promise.all([getWork(id), getArtist(artist.key)]);
      return curatedCard(w, a, catalog);
    }),
  }));
  const archiveWorks = await getArchiveWorks(artist);
  const archive = archiveWorks.map((w, i) => ({
    key: `a/${w.key}`,
    title: w.title,
    load: once(async () => {
      const [ctx, known] = await Promise.all([getArtistContext(w.artistName), knownArtistNames()]);
      return archiveCard(w, ctx, artist.key, { index: i, knownArtists: known, tags: catalog.tags });
    }),
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

  /** Work out an artist's next works. No side effects, so it is safe to call ahead of time. */
  const buildRun = useCallback(
    async (artist: ArtistRef, shownAlready = 0): Promise<Run | null> => {
      // The home feed skips what you've seen before; an artist's own page shows everything once.
      const exclude = new Set(shown.current);
      if (!only) for (const h of getState().history) exclude.add(h.key);
      const slots = await slotsFor(artist, exclude);
      if (!slots.length) return null;
      const take = Math.max(1, RUN_LENGTH - shownAlready);
      return { id: ++runIds, artist, slots: slots.slice(0, take), remaining: Math.max(0, slots.length - take) };
    },
    [only],
  );

  /** The run is going on the page: remember the artist and the works it shows. */
  const commit = useCallback(
    (run: Run, setCur: boolean, shownAlready = 0) => {
      if (!only) {
        markArtistVisited(run.artist.key, run.artist.period);
        if (setCur) setCurrent({ artist: run.artist.key, shown: shownAlready });
      }
      run.slots.forEach((s) => shown.current.add(s.key));
    },
    [only],
  );

  const findNextArtist = useCallback(async (): Promise<Run | null> => {
    const universe = await getUniverse();
    const r = rng(getState().seed + getState().visitedArtists.length * 7919);
    for (let tries = 0; tries < 8; tries++) {
      const s = getState();
      const a = pickNextArtist(universe, s.visitedArtists, s.lastPeriod, r);
      if (!a) return null;
      const run = await buildRun(a).catch(() => null);
      if (run) return run;
      markArtistVisited(a.key); // nothing unseen; skip it
    }
    return null;
  }, [buildRun]);

  // The next artist is chosen, and its first picture downloaded, while you're
  // still on the last works of this one, so leaving is immediate.
  const upcoming = useRef<Promise<Run | null> | null>(null);
  const prepareNext = useCallback(() => {
    if (only || upcoming.current) return;
    const p: Promise<Run | null> = findNextArtist()
      .then(async (run) => {
        const card = run && (await run.slots[0].load().catch(() => null));
        if (card) await warmImage(card.image.url);
        return run;
      })
      .catch(() => null)
      .then((run) => {
        if (!run && upcoming.current === p) upcoming.current = null; // let a retry start afresh
        return run;
      });
    upcoming.current = p;
  }, [findNextArtist, only]);

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
          if (a) run = await buildRun(a);
          if (run) commit(run, false);
        } else {
          const cur = getState().current;
          const a = cur && cur.shown < RUN_LENGTH ? universe.find((x) => x.key === cur.artist) : undefined;
          if (a && cur) {
            run = await buildRun(a, cur.shown);
            if (run) commit(run, cur.shown === 0, cur.shown);
          }
          if (!run) {
            run = await findNextArtist();
            if (run) commit(run, true);
          }
        }
        if (run) setRuns([run]);
        else setError(only ? "Nothing more to show here yet." : "Mona couldn’t reach the collections. Check your connection and try again.");
      } catch {
        setError("Mona couldn’t reach the collections. Check your connection and try again.");
      }
    })();
  }, [only, buildRun, commit, findNextArtist]);

  // "Keep going" extends the same run in place: the end panel gives way and
  // the next works carry on right where it was.
  const keepGoing = useCallback(
    async (run: Run) => {
      const next = await buildRun(run.artist, 0);
      if (!next) {
        setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, remaining: 0 } : r)));
        return;
      }
      commit(next, true);
      setRuns((rs) =>
        rs.map((r) => (r.id === run.id ? { ...r, slots: [...r.slots, ...next.slots], remaining: next.remaining } : r)),
      );
    },
    [buildRun, commit],
  );

  // Leaving swaps the feed for the new artist and starts at the top. It used
  // to append the new artist below and smooth-scroll to it, which stopped
  // short because the page hadn't grown yet. Resolves false if it couldn't.
  const [before, setBefore] = useState<string | null>(null);
  const toTop = useRef(false);
  const leave = useCallback(async (): Promise<boolean> => {
    if (only) {
      window.location.href = "/";
      return true;
    }
    prepareNext();
    const next = await upcoming.current;
    upcoming.current = null;
    if (!next) return false;
    commit(next, true);
    toTop.current = true;
    setBefore(runs[runs.length - 1]?.artist.name ?? null);
    setRuns([next]);
    return true;
  }, [commit, only, prepareNext, runs]);

  useLayoutEffect(() => {
    if (!toTop.current) return;
    toTop.current = false;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [runs]);

  if (error) return <p className={styles.empty}>{error}</p>;
  if (!runs.length) return <Loading />;

  return (
    <div className={styles.feed}>
      {before && (
        <p className={`${styles.before} smallcaps`}>
          After {before} · <Link href="/history">History</Link>
        </p>
      )}
      {runs.map((run, ri) => (
        <RunView
          key={run.id}
          run={run}
          last={ri === runs.length - 1}
          onContinue={() => keepGoing(run)}
          onLeave={leave}
          onNearEnd={prepareNext}
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
  onNearEnd,
}: {
  run: Run;
  last: boolean;
  onContinue: () => void;
  onLeave: () => Promise<boolean>;
  onNearEnd: () => void;
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

  // Reveal the next card only once the last one has arrived. Otherwise the
  // empty space where it will go keeps the sentinel in view, and every card
  // in the run gets revealed (and downloaded) at once.
  const lastReady = cards[revealed - 1] != null;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !lastReady) return;
    const io = new IntersectionObserver(
      (es) => es.some((e) => e.isIntersecting) && setRevealed((r) => Math.min(run.slots.length, r + 1)),
      { rootMargin: "120% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [run.slots.length, revealed, lastReady]);

  const shown = cards.slice(0, revealed).filter((c) => c && !(c as any).failed) as CardModel[];
  const done = revealed >= run.slots.length && cards.length >= run.slots.length && cards.every((c) => c !== null);

  // Two works from the end of a run, start choosing the next artist.
  const nearEnd = revealed >= run.slots.length - 2;
  useEffect(() => {
    if (last && nearEnd) onNearEnd();
  }, [last, nearEnd, onNearEnd]);

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
      {!done && <div ref={sentinel} className={styles.sentinel}>{cards[revealed - 1] == null && <Loading small />}</div>}
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
