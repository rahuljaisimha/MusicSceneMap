/**
 * Setlist.fm API client.
 * Docs: https://api.setlist.fm/docs/1.0/index.html
 *
 * Requires an API key (free registration at https://www.setlist.fm/settings/api).
 * For this POC, we store it in localStorage or prompt the user.
 *
 * CORS: Setlist.fm does not send Access-Control-Allow-Origin headers.
 * - In dev: Vite proxy rewrites /setlistfm-api → https://api.setlist.fm/rest/1.0
 * - In prod (GitHub Pages): uses a public CORS proxy as a fallback.
 */

const isDev = import.meta.env.DEV;

import { debugLog } from "../debug/DebugLog";
import { cachedFetch } from "./cache";

function getBaseUrl(): string {
  if (isDev) {
    return "/setlistfm-api";
  }
  // In production, use corsproxy.io as a lightweight CORS proxy.
  // This is acceptable for a low-traffic POC.
  return "https://corsproxy.io/?url=https://api.setlist.fm/rest/1.0";
}

export function getApiKey(): string | null {
  return localStorage.getItem("setlistfm_api_key");
}

export function setApiKey(key: string): void {
  localStorage.setItem("setlistfm_api_key", key);
}

export function isSetlistFmEnabled(): boolean {
  return localStorage.getItem("setlistfm_enabled") === "true";
}

export function setSetlistFmEnabled(value: boolean): void {
  localStorage.setItem("setlistfm_enabled", String(value));
}

async function setlistFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "Setlist.fm API key not configured. Get one at https://www.setlist.fm/settings/api"
    );
  }

  const baseUrl = getBaseUrl();
  const url = new URL(`${baseUrl}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Setlist.fm: Invalid API key");
    }
    throw new Error(`Setlist.fm API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// --- Types ---

export interface SetlistSearchResult {
  setlist: Setlist[];
  total: number;
  page: number;
  itemsPerPage: number;
}

export interface Setlist {
  id: string;
  eventDate: string; // dd-MM-yyyy
  artist: SetlistArtist;
  venue: SetlistVenue;
  tour?: { name: string };
  sets?: { set: SetlistSet[] };
}

export interface SetlistArtist {
  mbid: string;
  name: string;
}

export interface SetlistVenue {
  id: string;
  name: string;
  city: SetlistCity;
}

export interface SetlistCity {
  id: string;
  name: string;
  state?: string;
  stateCode?: string;
  coords?: { lat: number; long: number };
  country: { code: string; name: string };
}

export interface SetlistSet {
  name?: string;
  song?: SetlistSong[];
}

export interface SetlistSong {
  name: string;
  cover?: SetlistArtist; // original artist if this is a cover
  with?: SetlistArtist; // guest performer
}

// --- Public API ---

/**
 * Search setlists for an artist by MBID.
 */
export async function getSetlistsForArtist(
  mbid: string,
  page = 1
): Promise<SetlistSearchResult> {
  const cacheKey = `sl_setlists_${mbid}_${page}`;
  return cachedFetch(cacheKey, async () => {
    debugLog.log(`Querying Setlist.fm for setlists (${mbid}, page ${page})`);
    const result = await setlistFetch<SetlistSearchResult>(`/artist/${mbid}/setlists`, {
      p: page.toString(),
    });
    debugLog.log(`Setlist.fm returned ${result.setlist?.length ?? 0} setlists`);
    return result;
  });
}

/**
 * Extract unique venues from a list of setlists.
 */
export function extractVenues(
  setlists: Setlist[]
): Array<{ venue: SetlistVenue; playCount: number }> {
  const venueMap = new Map<string, { venue: SetlistVenue; playCount: number }>();
  for (const setlist of setlists) {
    const existing = venueMap.get(setlist.venue.id);
    if (existing) {
      existing.playCount++;
    } else {
      venueMap.set(setlist.venue.id, { venue: setlist.venue, playCount: 1 });
    }
  }
  return [...venueMap.values()].sort((a, b) => b.playCount - a.playCount);
}

/**
 * Extract artists whose songs were covered or who guested on setlists.
 */
export function extractRelatedArtists(
  setlists: Setlist[]
): Array<{ artist: SetlistArtist; relation: "cover" | "guest" }> {
  const seen = new Map<string, { artist: SetlistArtist; relation: "cover" | "guest" }>();
  for (const setlist of setlists) {
    if (!setlist.sets?.set) continue;
    for (const set of setlist.sets.set) {
      if (!set.song) continue;
      for (const song of set.song) {
        if (song.cover && !seen.has(song.cover.mbid)) {
          seen.set(song.cover.mbid, { artist: song.cover, relation: "cover" });
        }
        if (song.with && !seen.has(song.with.mbid)) {
          seen.set(song.with.mbid, { artist: song.with, relation: "guest" });
        }
      }
    }
  }
  return [...seen.values()];
}
