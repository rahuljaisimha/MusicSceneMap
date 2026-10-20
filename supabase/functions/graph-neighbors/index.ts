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
 *     neighbors: [{ node: { id, name, type }, relType: string }] }
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Relationship types we expose as artist-to-artist edges. Album-credit rel types
// are included because the client collapses album co-credits into collaborator
// edges; here they surface directly as the neighbor's rel_type.
const ARTIST_REL_TYPES = new Set([
  "member_of",
  "former_member_of",
  "support_musician",
  "collaborator",
  "producer",
  "vocal",
  "instrument",
  "mix",
  "engineer",
  "recording",
]);

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

    if (!mbid && !name) {
      return json({ error: "Missing 'mbid' or 'name' parameter" }, 400);
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
      .select("source_id, target_id, rel_type")
      .or(`source_id.eq.${artist.mbid},target_id.eq.${artist.mbid}`);

    const rels = (edges ?? []).filter((e) => ARTIST_REL_TYPES.has(e.rel_type));

    // Collect neighbor ids (the other end of each edge) + their rel_type.
    const neighborRel = new Map<string, string>();
    for (const e of rels) {
      const neighborId = e.source_id === artist.mbid ? e.target_id : e.source_id;
      if (neighborId === artist.mbid) continue;
      if (!neighborRel.has(neighborId)) neighborRel.set(neighborId, e.rel_type);
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
      .map(([id, relType]) => {
        const n = nodes.get(id)!;
        return { node: { id: n.mbid, name: n.name, type: n.type }, relType };
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
