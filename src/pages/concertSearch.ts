/**
 * The Discover search, streamed: find the city on Pollstar (one autocomplete
 * request), then page through the city's upcoming concerts (CITY_PAGE_SIZE per
 * request, soonest first). Each page's concerts are reported as soon as it
 * arrives (unscored), and again once their headliners are scored, re-sorted.
 * Network and scoring come in as `deps`, so this runs (and is tested) without React.
 */

import type { PollstarCity, PollstarEvent } from "../api/pollstar";
import { headlineArtist, sortConcerts, toConcert, type RankedConcert } from "./concerts";

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
  /** Headliners' similarity to the liked artists, keyed by the name as given. */
  scoreMany(artists: string[]): Promise<Map<string, { score: number; found: boolean }>>;
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
  const scores = new Map<string, { score: number; found: boolean }>(); // by lowercased headliner
  const queued = new Set<string>();
  const batches: string[][] = [];
  let scoringNow = 0;
  const progress: ConcertSearchProgress = {
    stage: "city",
    city: null,
    pagesLoaded: 0,
    pagesTotal: 0,
    concertsTotal: 0,
    scoring: 0,
  };
  const emit = () => {
    if (isStopped()) return;
    progress.scoring = batches.reduce((n, b) => n + b.length, 0) + scoringNow;
    onUpdate({ concerts: sortConcerts([...concerts.values()]), progress: { ...progress } });
  };

  // Scoring runs alongside the Pollstar requests, a page's headliners at a time.
  let pumping: Promise<void> | null = null;
  const pump = () => {
    if (pumping || batches.length === 0 || isStopped()) return;
    pumping = (async () => {
      while (batches.length > 0 && !isStopped()) {
        const batch = batches.shift()!;
        scoringNow = batch.length;
        const results = await deps.scoreMany(batch).catch(() => new Map<string, { score: number; found: boolean }>());
        scoringNow = 0;
        for (const name of batch) scores.set(name.toLowerCase(), results.get(name) ?? { score: 0, found: false });
        for (const [id, c] of concerts) {
          const s = !c.scored ? scores.get(c.artistName.toLowerCase()) : undefined;
          if (s) concerts.set(id, { ...c, scored: true, score: s.score, artistFound: s.found });
        }
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
  if (isStopped()) return;
  progress.stage = "done";
  emit();
}
