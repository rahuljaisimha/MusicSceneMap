const SUPABASE_FUNCTIONS_URL = "https://lwqkjtzqjgacgvfjiyxg.supabase.co/functions/v1";

export interface VenueResult {
  venue: string;
  city: string;
  country: string | null;
  showCount: number;
}

export interface VenueSearchResponse {
  source: "cache" | "api";
  artist: string;
  city: string;
  venues: VenueResult[];
}

/**
 * Search for venues where an artist has played in a given city.
 */
export async function searchVenues(artist: string, city: string): Promise<VenueSearchResponse> {
  const params = new URLSearchParams({ artist, city });
  const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/venue-search?${params}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Search venues for multiple artists in a city.
 * Returns aggregated results ranked by total show count across all artists.
 */
export async function searchVenuesForArtists(
  artists: string[],
  city: string
): Promise<Array<VenueResult & { artists: string[] }>> {
  const results = await Promise.allSettled(
    artists.map((artist) => searchVenues(artist, city))
  );

  // Aggregate venues across all artists
  const venueMap = new Map<string, { venue: VenueResult; artists: string[] }>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { venues, artist } = result.value;

    for (const v of venues) {
      const existing = venueMap.get(v.venue);
      if (existing) {
        existing.venue.showCount += v.showCount;
        existing.artists.push(artist);
      } else {
        venueMap.set(v.venue, { venue: { ...v }, artists: [artist] });
      }
    }
  }

  return [...venueMap.values()]
    .map(({ venue, artists }) => ({ ...venue, artists }))
    .sort((a, b) => b.showCount - a.showCount);
}
