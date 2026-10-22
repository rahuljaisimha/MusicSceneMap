/**
 * Artist suggestions for the search-as-you-type dropdowns.
 *
 * Suggestions come from the database: the local graph once it has loaded,
 * else Postgres (graph-neighbors' search mode, which never logs misses).
 * MusicBrainz is only a fallback for when the database has no match.
 * Each suggestion is labelled like MusicBrainz does — "Fuzz (US garage rock
 * band · San Francisco)" — from the disambiguation comment and the artist's
 * city/area (plus the top tag as genre for MusicBrainz fallback results), so
 * artists with the same name can be told apart. The committed graph has no
 * label columns until the next regen; until then labels come from Postgres.
 */

import type { ArtistMatch } from "./graphDb";
import type { MBArtist } from "../api/musicbrainz";

export interface ArtistSuggestion {
  id: string;
  name: string;
  /** "person" or "group" */
  type: string;
  disambiguation?: string;
  /** City (MusicBrainz begin area) or, failing that, area/country. */
  area?: string;
  /** Most-voted MusicBrainz tag. */
  genre?: string;
}

const GROUP_TYPES = new Set(["Group", "Orchestra", "Choir"]);

export function fromMusicBrainz(a: MBArtist): ArtistSuggestion {
  const topTag = [...(a.tags ?? [])].filter((t) => t.count > 0).sort((x, y) => y.count - x.count)[0];
  const area = a["begin-area"]?.name ?? a.area?.name;
  return {
    id: a.id,
    name: a.name,
    type: a.type && GROUP_TYPES.has(a.type) ? "group" : "person",
    ...(a.disambiguation ? { disambiguation: a.disambiguation } : {}),
    ...(area ? { area } : {}),
    ...(topTag ? { genre: topTag.name } : {}),
  };
}

/** A graph or Postgres match as a suggestion. */
function fromMatch(n: ArtistMatch): ArtistSuggestion {
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    ...(n.disambiguation ? { disambiguation: n.disambiguation } : {}),
    ...(n.area ? { area: n.area } : {}),
  };
}

export interface SuggestionSources {
  /** Postgres artist search. */
  searchDb: (query: string, limit: number) => Promise<ArtistMatch[]>;
  searchMusicBrainz: (query: string) => Promise<MBArtist[]>;
}

/** Postgres rows fetched to label graph matches (more than shown, so the shown ones are covered). */
const DB_LABEL_LIMIT = 25;

/**
 * Suggestions for a typed query. The database answers whenever it can:
 *   1. the local graph, when loaded (`local`), labelled from its own columns
 *      if it has them (`localHasLabels`), else from Postgres rows by MBID;
 *   2. Postgres, while the graph is still downloading or has no match.
 * MusicBrainz is only asked when the database has no match or can't be
 * reached. Resolves to null when every source it tried failed.
 */
export async function findSuggestions(
  query: string,
  local: ArtistMatch[] | null,
  localHasLabels: boolean,
  limit: number,
  sources: SuggestionSources
): Promise<ArtistSuggestion[] | null> {
  const graphHits = local?.slice(0, limit) ?? [];
  if (graphHits.length > 0 && localHasLabels) return graphHits.map(fromMatch);

  let db: ArtistMatch[] = [];
  let dbFailed = false;
  try {
    db = await sources.searchDb(query, graphHits.length > 0 ? DB_LABEL_LIMIT : limit);
  } catch {
    dbFailed = true;
  }

  if (graphHits.length > 0) {
    const labels = new Map(db.map((d) => [d.id, d]));
    return graphHits.map((n) => {
      const d = labels.get(n.id);
      return fromMatch({ ...n, disambiguation: n.disambiguation ?? d?.disambiguation, area: n.area ?? d?.area });
    });
  }
  if (db.length > 0) return db.slice(0, limit).map(fromMatch);

  try {
    return (await sources.searchMusicBrainz(query)).slice(0, limit).map(fromMusicBrainz);
  } catch {
    return dbFailed ? null : [];
  }
}

/**
 * The parenthetical shown after the name: disambiguation, city, genre.
 * Parts already mentioned in the disambiguation are left out
 * ("US garage rock band" doesn't need "garage rock" again).
 */
export function suggestionDetail(s: ArtistSuggestion): string | null {
  const parts: string[] = [];
  const seen = (s.disambiguation ?? "").toLowerCase();
  if (s.disambiguation) parts.push(s.disambiguation);
  for (const p of [s.area, s.genre]) {
    if (p && !seen.includes(p.toLowerCase()) && !parts.some((x) => x.toLowerCase() === p.toLowerCase())) parts.push(p);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Share requests for the same query across keystrokes; failed requests aren't kept. */
function memoize<T>(fn: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (key) => {
    const cached = cache.get(key);
    if (cached) return cached;
    const promise = fn(key);
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    return promise;
  };
}

const searchDbMemo = memoize(async (key: string) => {
  const [query, limit] = JSON.parse(key) as [string, number];
  const { searchArtistsDb } = await import("../api/supabase");
  const rows = await searchArtistsDb(query, limit);
  return rows.map((r): ArtistMatch => ({
    id: r.id,
    name: r.name,
    type: r.type,
    ...(r.disambiguation ? { disambiguation: r.disambiguation } : {}),
    ...(r.area ? { area: r.area } : {}),
  }));
});

const searchMusicBrainzMemo = memoize(async (query: string) => {
  const { searchArtistsPrefix } = await import("../api/musicbrainz");
  return searchArtistsPrefix(query, 25);
});

/** The app's real sources: Postgres (graph-neighbors search) and MusicBrainz. */
export const defaultSources: SuggestionSources = {
  searchDb: (query, limit) => searchDbMemo(JSON.stringify([query.trim().toLowerCase(), limit])),
  searchMusicBrainz: (query) => searchMusicBrainzMemo(query.trim().toLowerCase()),
};
