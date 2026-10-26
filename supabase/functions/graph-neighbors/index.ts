import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * graph-neighbors: resolve an artist (by name or mbid) and return the artist
 * plus its 1-hop neighbors from the `relationships` table.
 *
 * This backs the Tier-2 fallback in the client's tiered GraphAccess: when an
 * artist isn't in the browser's core SQLite graph, we ask Postgres. Misses
 * (artist not found here) are logged to `search_misses` like report-miss, so we
 * can see what coverage the graph is missing.
 *
 * Query params:
 *   - mbid:  artist MBID (preferred, unambiguous), OR
 *   - name:  artist name (case-insensitive; exact match preferred)
 *   - log:   "0" to skip logging a miss (used while the browser graph is still
 *            downloading, when a miss says nothing about SQLite coverage)
 *
 * Response:
 *   { found: boolean,
 *     artist: { id, name, type } | null,
 *     neighbors: [{ node: { id, name, type }, relType: string, outgoing: boolean, count: number }] }
 *   (outgoing: the artist is the edge's source, e.g. the producer in produced_for;
 *    count: song credits for collaborated_with / produced_for, else 1)
 *
 * Search mode, for the app's artist dropdowns (no neighbors, never logs: a
 * partial name typed into a dropdown isn't a lookup that missed):
 *   - q:     typed text (at least 2 characters)
 *   - limit: max results (default 8, max 25)
 *
 * Response:
 *   { artists: [{ id, name, type, disambiguation, area }] }
 *
 * Ranked: exact name, then names starting with q, then names with a word
 * starting with q, then other matches; shorter names first. `area` (usually
 * a city) is null until migration 004 has run and the table is re-seeded.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Relationship types we expose as artist-to-artist edges. Collaborations point
// from the credited artist to the record's artist (seed_supabase.py); the
// response says which way each edge points (`outgoing`).
const ARTIST_REL_TYPES = new Set([
  "member_of",
  "former_member_of",
  "support_musician",
  "collaborated_with",
  "produced_for",
  "opened_for",
]);

// Search candidates fetched per pattern before ranking.
const SEARCH_CANDIDATES = 100;

interface ArtistRow {
  mbid: string;
  name: string;
  type: string;
  disambiguation?: string | null;
  area?: string | null;
}

function searchRank(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(` ${q}`)) return 2;
  return 3;
}

async function searchArtists(q: string, limit: number): Promise<Response> {
  if (q.length < 2) return json({ artists: [] });
  // Match the typed text literally (no LIKE wildcards from the user).
  const pattern = q.replace(/[\\%_]/g, "\\$&");
  // select("*") so the optional area column is returned once migration 004 has run.
  const [prefix, contains] = await Promise.all([
    supabase.from("artists").select("*").ilike("name", `${pattern}%`).limit(SEARCH_CANDIDATES),
    supabase.from("artists").select("*").ilike("name", `%${pattern}%`).limit(SEARCH_CANDIDATES),
  ]);
  const error = prefix.error ?? contains.error;
  if (error) return json({ error: error.message }, 500);

  const byId = new Map<string, ArtistRow>();
  for (const row of [...(prefix.data ?? []), ...(contains.data ?? [])] as ArtistRow[]) {
    byId.set(row.mbid, row);
  }
  const lower = q.toLowerCase();
  const artists = [...byId.values()]
    .sort((a, b) =>
      searchRank(a.name, lower) - searchRank(b.name, lower) ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((a) => ({
      id: a.mbid,
      name: a.name,
      type: a.type,
      disambiguation: a.disambiguation || null,
      area: a.area || null,
    }));
  return json({ artists });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const mbid = url.searchParams.get("mbid");
    const name = url.searchParams.get("name");
    const logMiss = url.searchParams.get("log") !== "0";

    const q = url.searchParams.get("q");
    if (q !== null) {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 8, 1), 25);
      return await searchArtists(q.trim(), limit);
    }

    if (!mbid && !name) {
      return json({ error: "Missing 'mbid', 'name' or 'q' parameter" }, 400);
    }

    // 1. Resolve the artist row.
    let artist: { mbid: string; name: string; type: string } | null = null;
    if (mbid) {
      const { data } = await supabase
        .from("artists")
        .select("mbid, name, type")
        .eq("mbid", mbid)
        .limit(1)
        .maybeSingle();
      artist = data ?? null;
    } else if (name) {
      const { data } = await supabase
        .from("artists")
        .select("mbid, name, type")
        .ilike("name", name)
        .limit(1)
        .maybeSingle();
      artist = data ?? null;
    }

    if (!artist) {
      // Log the miss so we can track missing coverage.
      if (logMiss) {
        await supabase.from("search_misses").insert({
          query: mbid ?? name ?? "",
          source: "graph-neighbors-not-found",
        });
      }
      return json({ found: false, artist: null, neighbors: [] });
    }

    // 2. Fetch 1-hop edges in both directions.
    const { data: edges } = await supabase
      .from("relationships")
      .select("source_id, target_id, rel_type, count")
      .or(`source_id.eq.${artist.mbid},target_id.eq.${artist.mbid}`);

    const rels = (edges ?? []).filter((e) => ARTIST_REL_TYPES.has(e.rel_type));

    // Collect neighbor ids (the other end of each edge) + their rel_type and
    // count (song credits for collaborations; 1 for band edges).
    const neighborRel = new Map<string, { relType: string; outgoing: boolean; count: number }>();
    for (const e of rels) {
      const outgoing = e.source_id === artist.mbid;
      const neighborId = outgoing ? e.target_id : e.source_id;
      if (neighborId === artist.mbid) continue;
      if (!neighborRel.has(neighborId)) {
        neighborRel.set(neighborId, { relType: e.rel_type, outgoing, count: e.count ?? 1 });
      }
    }

    // 3. Resolve neighbor artist rows (chunked to avoid oversized IN lists).
    const neighborIds = [...neighborRel.keys()];
    const nodes = new Map<string, { mbid: string; name: string; type: string }>();
    const CHUNK = 200;
    for (let i = 0; i < neighborIds.length; i += CHUNK) {
      const chunk = neighborIds.slice(i, i + CHUNK);
      const { data } = await supabase
        .from("artists")
        .select("mbid, name, type")
        .in("mbid", chunk);
      for (const row of data ?? []) nodes.set(row.mbid, row);
    }

    const neighbors = [...neighborRel.entries()]
      .filter(([id]) => nodes.has(id))
      .map(([id, { relType, outgoing, count }]) => {
        const n = nodes.get(id)!;
        return { node: { id: n.mbid, name: n.name, type: n.type }, relType, outgoing, count };
      });

    return json({
      found: true,
      artist: { id: artist.mbid, name: artist.name, type: artist.type },
      neighbors,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
