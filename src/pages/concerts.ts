/**
 * Pure logic for turning Pollstar upcoming events into similarity-ranked concert
 * recommendations. Kept free of React and network code so it can be unit-tested.
 *
 * Ranking: each concert is scored by how similar its HEADLINE artist is to the
 * user's taste list (via the graph-based similarity engine). Artists not present
 * in the graph score 0 and sort to the bottom (still shown, flagged not-found) —
 * hit rate can be improved later (more artists in SQLite, or a backend fallback).
 */

import type { ArtistRef, GraphAccess } from "./similarity";
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
  /** Whether the headline artist was found in the graph. */
  artistFound: boolean;
  /** Similarity of the headline artist to the taste list, 0..100. */
  score: number;
  /** Ticket links, if any. */
  tickets: PollstarEvent["tickets"];
}

/** Pick the headline artist for an event, falling back to the first listed. */
export function headlineArtist(event: PollstarEvent): string | null {
  if (event.artists.length === 0) return null;
  const headline = event.artists.find((a) => a.isHeadline);
  return (headline ?? event.artists[0]!).name;
}

/**
 * Rank a set of events by headline-artist similarity to the taste list.
 *
 * `scoreCache` memoizes per-artist scores so the same headliner appearing at
 * multiple venues is only scored once.
 */
export function rankConcerts(
  graph: GraphAccess,
  events: PollstarEvent[],
  listArtists: ArtistRef[]
): RankedConcert[] {
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

    ranked.push({
      id: event.id,
      eventName: event.name,
      playDate: event.playDate,
      eventUrl: event.url,
      venueName: event.venueName,
      isFestival: event.isFestival,
      artistName: headline,
      supportingArtists: event.artists
        .map((a) => a.name)
        .filter((n) => n.toLowerCase() !== headline.toLowerCase()),
      artistFound: scored.found,
      score: scored.score,
      tickets: event.tickets,
    });
  }

  // Highest similarity first; break ties by soonest date.
  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.playDate.localeCompare(b.playDate);
  });
}

/** Deduplicate events by id (same event can surface via multiple venue queries). */
export function dedupeEvents(events: PollstarEvent[]): PollstarEvent[] {
  const seen = new Map<string, PollstarEvent>();
  for (const e of events) {
    if (!seen.has(e.id)) seen.set(e.id, e);
  }
  return [...seen.values()];
}
