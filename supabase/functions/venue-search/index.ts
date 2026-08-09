import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SETLISTFM_BASE = "https://api.setlist.fm/rest/1.0";
const SETLISTFM_API_KEY = Deno.env.get("SETLISTFM_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Cache duration: don't re-fetch from Setlist.fm if data is less than 7 days old
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const artistMbid = url.searchParams.get("artistMbid");
    const artistName = url.searchParams.get("artist");
    const city = url.searchParams.get("city");

    if (!city) {
      return new Response(
        JSON.stringify({ error: "Missing 'city' parameter" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Resolve artist MBID from name if needed
    let mbid = artistMbid;
    if (!mbid && artistName) {
      const { data: artist } = await supabase
        .from("artists")
        .select("mbid")
        .ilike("name", artistName)
        .limit(1)
        .single();

      if (artist) {
        mbid = artist.mbid;
      } else {
        return new Response(
          JSON.stringify({ error: `Artist "${artistName}" not found` }),
          { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
    }

    if (!mbid) {
      return new Response(
        JSON.stringify({ error: "Provide 'artistMbid' or 'artist' parameter" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Check cache: do we already have venue data for this artist in this city?
    const { data: cachedVenues } = await supabase
      .from("relationships")
      .select(`
        target_id,
        count,
        venues!inner(id, name, city, state, country)
      `)
      .eq("source_id", mbid)
      .eq("rel_type", "played_at")
      .eq("venues.city", city);

    // If we have cached data, return it
    // TODO: Add a crawl_log table to track when we last fetched for staleness checks
    if (cachedVenues && cachedVenues.length > 0) {
      const results = cachedVenues.map((r: any) => ({
        venue: r.venues.name,
        city: r.venues.city,
        country: r.venues.country,
        showCount: r.count,
      }));
      results.sort((a: any, b: any) => b.showCount - a.showCount);

      return new Response(
        JSON.stringify({ source: "cache", artist: mbid, city, venues: results }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Cache miss — fetch from Setlist.fm API
    const setlistResponse = await fetch(
      `${SETLISTFM_BASE}/search/setlists?artistMbid=${mbid}&cityName=${encodeURIComponent(city)}&p=1`,
      {
        headers: {
          Accept: "application/json",
          "x-api-key": SETLISTFM_API_KEY,
        },
      }
    );

    if (!setlistResponse.ok) {
      const status = setlistResponse.status;
      if (status === 404) {
        return new Response(
          JSON.stringify({ source: "api", artist: mbid, city, venues: [] }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: `Setlist.fm API error: ${status}` }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const setlistData = await setlistResponse.json();
    const setlists = setlistData.setlist || [];

    // Aggregate venues with play counts
    const venueMap = new Map<string, { venue: any; count: number }>();

    for (const setlist of setlists) {
      const venue = setlist.venue;
      if (!venue) continue;

      const existing = venueMap.get(venue.id);
      if (existing) {
        existing.count++;
      } else {
        venueMap.set(venue.id, { venue, count: 1 });
      }
    }

    // Store venues and relationships in Supabase
    for (const [venueId, { venue, count }] of venueMap) {
      const venueCity = venue.city || {};

      // Upsert venue
      await supabase.from("venues").upsert({
        id: venueId,
        name: venue.name,
        city: venueCity.name || null,
        state: venueCity.state || null,
        country: venueCity.country?.name || null,
      }, { onConflict: "id" });

      // Upsert played_at relationship
      const { data: existing } = await supabase
        .from("relationships")
        .select("id, count")
        .eq("source_id", mbid)
        .eq("target_id", venueId)
        .eq("rel_type", "played_at")
        .single();

      if (existing) {
        await supabase
          .from("relationships")
          .update({ count: Math.max(existing.count, count) })
          .eq("id", existing.id);
      } else {
        await supabase.from("relationships").insert({
          source_id: mbid,
          target_id: venueId,
          rel_type: "played_at",
          count,
        });
      }
    }

    // Return results
    const results = [...venueMap.values()]
      .map(({ venue, count }) => ({
        venue: venue.name,
        city: venue.city?.name || city,
        country: venue.city?.country?.name || null,
        showCount: count,
      }))
      .sort((a, b) => b.showCount - a.showCount);

    return new Response(
      JSON.stringify({ source: "api", artist: mbid, city, venues: results }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
