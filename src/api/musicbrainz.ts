/**
 * MusicBrainz API client.
 * Docs: https://musicbrainz.org/doc/MusicBrainz_API
 *
 * Rate limit: 1 request per second. We add a simple delay mechanism.
 */

const BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = "MusicSceneMap/0.0.1 (https://github.com/musicscenemap)";

import { debugLog } from "../debug/DebugLog";

let lastRequestTime = 0;

async function mbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  // Respect 1 req/sec rate limit
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("fmt", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// --- Types for MusicBrainz responses (simplified) ---

export interface MBArtistSearchResult {
  artists: MBArtist[];
}

export interface MBArtist {
  id: string; // MBID
  name: string;
  disambiguation?: string;
  country?: string;
  "life-span"?: { begin?: string; end?: string; ended?: boolean };
  relations?: MBRelation[];
}

export interface MBRelation {
  type: string; // e.g. "member of band", "label"
  "target-type": string; // e.g. "artist", "label", "url"
  direction: "forward" | "backward";
  begin?: string;
  end?: string;
  ended?: boolean;
  artist?: MBArtist;
  label?: { id: string; name: string };
  attributes?: string[];
}

// --- Public API ---

/**
 * Search for artists by name.
 */
export async function searchArtists(query: string, limit = 10): Promise<MBArtist[]> {
  debugLog.log(`Querying MusicBrainz for "${query}"`);
  const result = await mbFetch<MBArtistSearchResult>("/artist", {
    query: `artist:"${query}"`,
    limit: limit.toString(),
  });
  debugLog.log(`MusicBrainz returned ${result.artists.length} results for "${query}"`);
  return result.artists;
}

/**
 * Get a single artist with relationships (members, labels, etc.)
 */
export async function getArtistWithRelations(mbid: string): Promise<MBArtist> {
  debugLog.log(`Querying MusicBrainz for artist relations (${mbid})`);
  return mbFetch<MBArtist>(`/artist/${mbid}`, {
    inc: "artist-rels+label-rels",
  });
}

/**
 * Get members of a group (artists related as "member of band").
 */
export function extractMembers(artist: MBArtist): Array<{
  artist: MBArtist;
  current: boolean;
}> {
  if (!artist.relations) return [];
  return artist.relations
    .filter(
      (rel) =>
        rel.type === "member of band" &&
        rel["target-type"] === "artist" &&
        rel.direction === "backward" &&
        rel.artist
    )
    .map((rel) => ({
      artist: rel.artist!,
      current: !rel.ended,
    }));
}

/**
 * Get bands a musician belongs to.
 */
export function extractBands(artist: MBArtist): Array<{
  artist: MBArtist;
  current: boolean;
}> {
  if (!artist.relations) return [];
  return artist.relations
    .filter(
      (rel) =>
        rel.type === "member of band" &&
        rel["target-type"] === "artist" &&
        rel.direction === "forward" &&
        rel.artist
    )
    .map((rel) => ({
      artist: rel.artist!,
      current: !rel.ended,
    }));
}

/**
 * Get labels associated with an artist.
 */
export function extractLabels(artist: MBArtist): Array<{ id: string; name: string }> {
  if (!artist.relations) return [];
  return artist.relations
    .filter((rel) => rel["target-type"] === "label" && rel.label)
    .map((rel) => rel.label!);
}
