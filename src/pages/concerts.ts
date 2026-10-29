/**
 * Pure logic for turning Pollstar upcoming events into similarity-ranked concert
 * recommendations. Kept free of React and network code so it can be unit-tested.
 *
 * Ranking: each concert is scored by how similar its HEADLINE artist is to the
 * user's taste list (via the graph-based similarity engine). Artists not present
 * in the graph score 0 and sort to the bottom (still shown, flagged not-found).
 * Discover streams them (concertSearch.ts): a concert is listed before its
 * headliner is scored (`scored: false`) and moves into place once it is.
 */

import type { ArtistRef, GraphAccess, HeadlinerScore, PairScore } from "./similarity";
import { scoreArtistAgainstList } from "./similarity";
import type { PollstarEvent } from "../api/pollstar";

export interface RankedConcert {
  id: string;
  eventName: string;
  playDate: string; // ISO
  eventUrl: string | null;
  venueName: string;
  isFestival: boolean;
  /** Headline artist used for scoring (falls back to first artist). */
  artistName: string;
  /** Other artists on the bill. */
  supportingArtists: string[];
  /** Whether the headliner has been scored yet (score / artistFound are 0 / false until then). */
  scored: boolean;
  /** Whether the headline artist was found in the graph. */
  artistFound: boolean;
  /** Similarity of the headline artist to the taste list, 0..100. */
  score: number;
  /** How the headliner connects to each liked artist (read from the liked artist), once scored. */
  pairs?: PairScore[];
}

/** Pick the headline artist for an event, falling back to the first listed. */
export function headlineArtist(event: PollstarEvent): string | null {
  if (event.artists.length === 0) return null;
  const headline = event.artists.find((a) => a.isHeadline);
  return (headline ?? event.artists[0]!).name;
}

/** An event as a concert card, with its headliner's score when known. */
export function toConcert(
  event: PollstarEvent,
  headline: string,
  scored?: HeadlinerScore
): RankedConcert {
  return {
    id: event.id,
    eventName: event.name,
    playDate: event.playDate,
    eventUrl: event.url,
    venueName: event.venueName,
    isFestival: event.isFestival,
    artistName: headline,
    supportingArtists: event.artists.map((a) => a.name).filter((n) => n.toLowerCase() !== headline.toLowerCase()),
    scored: scored !== undefined,
    artistFound: scored?.found ?? false,
    score: scored?.score ?? 0,
    ...(scored?.pairs ? { pairs: scored.pairs } : {}),
  };
}

/** Scored concerts first, highest similarity first (ties: soonest); then unscored ones by date. */
export function sortConcerts(concerts: RankedConcert[]): RankedConcert[] {
  return [...concerts].sort((a, b) => {
    if (a.scored !== b.scored) return a.scored ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.playDate.localeCompare(b.playDate);
  });
}

/**
 * Rank a set of events by headline-artist similarity to the taste list, all at
 * once. Each headliner is scored once, however many venues it plays.
 */
export function rankConcerts(graph: GraphAccess, events: PollstarEvent[], listArtists: ArtistRef[]): RankedConcert[] {
  const scoreCache = new Map<string, { score: number; found: boolean }>();
  const ranked: RankedConcert[] = [];
  for (const event of events) {
    const headline = headlineArtist(event);
    if (!headline) continue;
    let scored = scoreCache.get(headline.toLowerCase());
    if (!scored) {
      const { score, found } = scoreArtistAgainstList(graph, headline, listArtists);
      scored = { score, found };
      scoreCache.set(headline.toLowerCase(), scored);
    }
    ranked.push(toConcert(event, headline, scored));
  }
  return sortConcerts(ranked);
}

/** Deduplicate events by id (same event can surface via multiple venue queries). */
export function dedupeEvents(events: PollstarEvent[]): PollstarEvent[] {
  const seen = new Map<string, PollstarEvent>();
  for (const e of events) {
    if (!seen.has(e.id)) seen.set(e.id, e);
  }
  return [...seen.values()];
}
