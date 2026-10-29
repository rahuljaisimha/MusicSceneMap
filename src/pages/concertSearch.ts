/**
 * The Discover search, streamed: find the city on Pollstar (one autocomplete
 * request), then page through the city's upcoming concerts (CITY_PAGE_SIZE per
 * request, soonest first). Each page's concerts are reported as soon as it
 * arrives (unscored), and again once their headliners are scored, re-sorted.
 * Network and scoring come in as `deps`, so this runs (and is tested) without React.
 */

import type { PollstarCity, PollstarEvent } from "../api/pollstar";
import { headlineArtist, sortConcerts, toConcert, type RankedConcert } from "./concerts";
import type { HeadlinerScore } from "./similarity";

/** Concerts per Pollstar page (the pollstar-city function asks for this many). */
export const CITY_PAGE_SIZE = 100;
/** At most this many pages (so the first 1,000 concerts) per search. */
export const MAX_CITY_PAGES = 10;

export interface CityEventsPage {
  events: PollstarEvent[];
  totalPages: number;
  totalEvents: number;
}

export interface ConcertSearchDeps {
  /** The Pollstar city the user means, or null when there's none. */
  findCity(query: string): Promise<PollstarCity | null>;
  /** One page of the city's upcoming concerts, soonest first (paced: Pollstar is rate limited). */
  cityEvents(cityId: string, page: number): Promise<CityEventsPage>;
  /**
   * Headliners' similarity to the liked artists, keyed by the name as given. Each
   * one can be reported through `onScore` as soon as it's known (closest first),
   * before the whole batch is done.
   */
  scoreMany(
    artists: string[],
    onScore: (artist: string, score: HeadlinerScore) => void
  ): Promise<Map<string, HeadlinerScore>>;
  /**
   * Optional: headliners scoreMany left out (missing from what it could look up
   * quickly) are put off until every page is in and scored, then handed here,
   * to look up the slow way (MusicBrainz, about one a second) and score.
   * Without it they score 0.
   */
  scoreLater?(
    artists: string[],
    onScore: (artist: string, score: HeadlinerScore) => void,
    isStopped: () => boolean
  ): Promise<void>;
}

export interface ConcertSearchProgress {
  stage: "city" | "concerts" | "done" | "stopped";
  /** The city found ("Berlin, Germany"), null until then (or when there's none). */
  city: string | null;
  /** Pages loaded / to load (MAX_CITY_PAGES at most). */
  pagesLoaded: number;
  pagesTotal: number;
  /** Upcoming concerts Pollstar has for the city (may be more than are loaded). */
  concertsTotal: number;
  /** Headliners still waiting for their score. */
  scoring: number;
  /** Of those, the ones put off to be looked up on MusicBrainz at the end. */
  lookingUp: number;
}

export interface ConcertSearchUpdate {
  /** Every concert loaded so far: scored ones by score, then the rest by date. */
  concerts: RankedConcert[];
  progress: ConcertSearchProgress;
}

/**
 * The city a search means among Pollstar's matches: an exact "Berlin, Germany"
 * first, else a city named exactly that (the biggest: Berlin, Germany over
 * Berlin, MD), else the biggest whose name starts with it.
 */
export function pickCity(cities: PollstarCity[], query: string): PollstarCity | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byRank = [...cities].sort((a, b) => b.rank - a.rank);
  return (
    byRank.find((c) => c.name.toLowerCase() === q) ??
    byRank.find((c) => (c.city ?? "").toLowerCase() === q) ??
    byRank.find((c) => c.name.toLowerCase().startsWith(q)) ??
    null
  );
}

/**
 * Run the search, calling `onUpdate` after every change (city found, a page of
 * concerts added, a page's headliners scored). Stops early when `isStopped()`
 * turns true: nothing more is requested or reported.
 */
export async function streamConcerts(
  query: string,
  deps: ConcertSearchDeps,
  onUpdate: (update: ConcertSearchUpdate) => void,
  isStopped: () => boolean = () => false
): Promise<void> {
  const concerts = new Map<string, RankedConcert>();
  const scores = new Map<string, HeadlinerScore>(); // by lowercased headliner
  const queued = new Set<string>();
  const batches: string[][] = [];
  /** Headliners put off for scoreLater. */
  const later: string[] = [];
  let scoringNow = 0;
  const progress: ConcertSearchProgress = {
    stage: "city",
    city: null,
    pagesLoaded: 0,
    pagesTotal: 0,
    concertsTotal: 0,
    scoring: 0,
    lookingUp: 0,
  };
  const emit = () => {
    if (isStopped()) return;
    progress.lookingUp = later.length;
    progress.scoring = batches.reduce((n, b) => n + b.length, 0) + scoringNow + later.length;
    onUpdate({ concerts: sortConcerts([...concerts.values()]), progress: { ...progress } });
  };

  // Each headliner's concerts move into place as soon as its score is known
  const apply = (name: string, sc: HeadlinerScore) => {
    const key = name.toLowerCase();
    if (scores.has(key)) return;
    scores.set(key, sc);
    scoringNow = Math.max(0, scoringNow - 1);
    for (const [id, c] of concerts) {
      if (!c.scored && c.artistName.toLowerCase() === key) {
        concerts.set(id, { ...c, scored: true, score: sc.score, artistFound: sc.found, ...(sc.pairs ? { pairs: sc.pairs } : {}) });
      }
    }
    emit();
  };

  // Scoring runs alongside the Pollstar requests, a page's headliners at a time.
  let pumping: Promise<void> | null = null;
  const pump = () => {
    if (pumping || batches.length === 0 || isStopped()) return;
    pumping = (async () => {
      while (batches.length > 0 && !isStopped()) {
        const batch = batches.shift()!;
        scoringNow = batch.length;
        const results = await deps
          .scoreMany(batch, (name, sc) => {
            if (!isStopped()) apply(name, sc);
          })
          .catch(() => new Map<string, HeadlinerScore>());
        for (const name of batch) {
          if (scores.has(name.toLowerCase())) continue;
          const sc = results.get(name);
          if (sc) apply(name, sc);
          else if (deps.scoreLater) later.push(name);
          else apply(name, { score: 0, found: false });
        }
        scoringNow = 0;
        emit();
      }
    })().finally(() => {
      pumping = null;
    });
  };

  emit();
  const city = await deps.findCity(query);
  if (isStopped()) return;
  if (!city) {
    progress.stage = "done";
    emit();
    return;
  }
  progress.stage = "concerts";
  progress.city = city.name;
  emit();

  for (let page = 0; progress.pagesTotal === 0 || page < progress.pagesTotal; page++) {
    if (isStopped()) return;
    let result: CityEventsPage;
    try {
      result = await deps.cityEvents(city.id, page);
    } catch {
      break; // a page that fails ends the list there
    }
    if (isStopped()) return;
    progress.pagesTotal = Math.min(Math.max(result.totalPages, 1), MAX_CITY_PAGES);
    progress.concertsTotal = result.totalEvents;
    progress.pagesLoaded = page + 1;
    const batch: string[] = [];
    for (const event of result.events) {
      const headline = headlineArtist(event);
      if (!headline || concerts.has(event.id)) continue;
      const key = headline.toLowerCase();
      concerts.set(event.id, toConcert(event, headline, scores.get(key)));
      if (!scores.has(key) && !queued.has(key)) {
        queued.add(key);
        batch.push(headline);
      }
    }
    if (batch.length > 0) batches.push(batch);
    emit();
    pump();
    if (result.events.length === 0) break;
  }

  // Let the scoring finish (a batch can be queued just as a run of it ends)
  for (;;) {
    if (pumping) await pumping;
    else if (batches.length > 0 && !isStopped()) pump();
    else break;
  }
  // Last, the headliners put off for the slow lookup, one at a time
  if (later.length > 0 && deps.scoreLater && !isStopped()) {
    const todo = [...later];
    emit();
    await deps
      .scoreLater(
        todo,
        (name, sc) => {
          if (isStopped()) return;
          const i = later.findIndex((l) => l.toLowerCase() === name.toLowerCase());
          if (i >= 0) later.splice(i, 1);
          apply(name, sc);
        },
        isStopped
      )
      .catch(() => {});
    if (isStopped()) return;
    for (const name of later.splice(0)) apply(name, { score: 0, found: false });
  }
  if (isStopped()) return;
  progress.stage = "done";
  emit();
}

/**
 * How far along a search is, 0..1, for the progress bar: loading pages and
 * scoring what they bring both count (a page isn't done until its concerts are
 * scored).
 */
export function searchProgress(progress: ConcertSearchProgress, concerts: RankedConcert[]): number {
  if (progress.stage === "done") return 1;
  if (!progress.city || progress.pagesTotal === 0) return 0.05;
  const pages = progress.pagesLoaded / progress.pagesTotal;
  const scored = concerts.length === 0 ? 1 : concerts.filter((c) => c.scored).length / concerts.length;
  return Math.min(1, 0.05 + 0.25 * pages + 0.7 * pages * scored);
}

