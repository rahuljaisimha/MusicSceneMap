/**
 * pollstar-city: Discover's Pollstar data, fetched by our server and shared by
 * every visitor through a 24-hour cache. Replaces pollstar-events (venue by
 * venue), which stays deployed until it's deleted.
 *
 *   GET ?search=<city name>               Pollstar's autocomplete (cities, venues, artists...)
 *   GET ?city=<Pollstar city id>&page=<n> a page (PAGE_SIZE) of the city's upcoming
 *                                          events, soonest first, today to YEARS_AHEAD out
 *       &from=YYYY-MM-DD&to=YYYY-MM-DD    ... or within those dates (both or neither;
 *                                          from no earlier than yesterday, to no later
 *                                          than YEARS_AHEAD out)
 *   → { source: "cache" | "pollstar" | "stale", fetchedAt, data: <Pollstar's JSON> }
 *   → 503 { unavailable: true } when Pollstar refuses and nothing is cached
 *
 * The cache is the user_requested_data table (migration 009): a search is a
 * `pollstar_search` row (key: the lowercased search, as pollstar-events stores
 * it), a page of a city's events a `pollstar_city` row (key: "<city id>:<page>",
 * or "<city id>:<from>:<to>:<page>" for a date range).
 * A row under CACHE_TTL_MS old is served without asking Pollstar; when Pollstar
 * refuses, an older row is served as "stale". Everything stored was fetched here,
 * so nothing a browser sends ends up in the table.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const YEARS_AHEAD = 4;
const PAGE_SIZE = 100;
const MAX_PAGE = 49;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const CITY_ID = /^\d{1,12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A YYYY-MM-DD date as UTC midnight, or null when it isn't one. */
function parseDate(s: string): Date | null {
  if (!DATE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mmddyyyy(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
}

/** Pollstar's JSON, or null when it refuses (HTTP error, a challenge page, a network error). */
async function fromPollstar(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    if (!r.ok) {
      console.error(`pollstar-city: HTTP ${r.status} for ${url}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error(`pollstar-city: ${e instanceof Error ? e.message : e} for ${url}`);
    return null;
  }
}

async function cached(source: string, key: string) {
  const { data } = await supabase.from("user_requested_data").select("data, fetched_at")
    .eq("source", source).eq("key", key).maybeSingle();
  return data as { data: any; fetched_at: string } | null;
}

async function store(source: string, key: string, data: unknown) {
  const { error } = await supabase.from("user_requested_data").upsert({
    source, key, data, version: await sha256(JSON.stringify(data)), fetched_at: new Date().toISOString(),
  }, { onConflict: "source,key" });
  if (error) console.error("pollstar-city: caching failed:", error.message);
}

/** Serve from the cache when fresh, else Pollstar (and cache it), else the stale cache, else 503. */
async function serveCached(source: string, key: string, fetchFresh: () => Promise<any | null>, view = (d: any) => d) {
  const hit = await cached(source, key);
  if (hit && Date.now() - new Date(hit.fetched_at).getTime() < CACHE_TTL_MS) {
    return reply(200, { source: "cache", fetchedAt: hit.fetched_at, data: view(hit.data) });
  }
  const fresh = await fetchFresh();
  if (fresh) {
    await store(source, key, fresh);
    return reply(200, { source: "pollstar", fetchedAt: new Date().toISOString(), data: view(fresh) });
  }
  if (hit) return reply(200, { source: "stale", fetchedAt: hit.fetched_at, data: view(hit.data) });
  return reply(503, { unavailable: true });
}

/** Drops events that have already happened (a cached page can be up to a day old). */
function upcoming(data: any) {
  const today = new Date().toISOString().slice(0, 10);
  return { ...data, events: (data?.events ?? []).filter((e: any) => String(e?.playDate ?? "").slice(0, 10) >= today) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "GET") return reply(405, { error: "GET only" });
  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search");
    const cityId = url.searchParams.get("city");

    if (cityId !== null) {
      const page = Number(url.searchParams.get("page") ?? "0");
      if (!CITY_ID.test(cityId)) return reply(400, { error: "bad city" });
      if (!Number.isInteger(page) || page < 0 || page > MAX_PAGE) return reply(400, { error: "bad page" });
      const fromParam = url.searchParams.get("from");
      const toParam = url.searchParams.get("to");
      if ((fromParam === null) !== (toParam === null)) return reply(400, { error: "give both from and to, or neither" });
      const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
      const last = new Date(today);
      last.setUTCFullYear(last.getUTCFullYear() + YEARS_AHEAD);
      let range: { from: Date; to: Date } = { from: today, to: last };
      if (fromParam !== null && toParam !== null) {
        const from = parseDate(fromParam);
        const to = parseDate(toParam);
        // A visitor's "today" can be UTC's yesterday; Pollstar only serves from today
        if (!from || !to || from.getTime() < today.getTime() - DAY_MS || to < from || to.getTime() > last.getTime() + DAY_MS) {
          return reply(400, { error: "bad dates" });
        }
        range = { from: from < today ? today : from, to };
      }
      const key = fromParam !== null ? `${cityId}:${fromParam}:${toParam}:${page}` : `${cityId}:${page}`;
      return await serveCached("pollstar_city", key, async () => {
        const qs = new URLSearchParams({
          page: String(page), pageSize: String(PAGE_SIZE), fromDate: mmddyyyy(range.from), toDate: mmddyyyy(range.to),
          sortAscending: "true", sortColumn: "playdate", newOnly: "false",
        });
        const events = await fromPollstar(`https://www.pollstar.com/api/cities/${cityId}/events?${qs}`);
        return events && Array.isArray(events.events) ? events : null;
      }, upcoming);
    }
    if (search !== null) {
      if (search.trim() === "" || search.length > 100) return reply(400, { error: "bad search" });
      return await serveCached("pollstar_search", search.trim().toLowerCase(), async () => {
        const result = await fromPollstar(`https://autocomplete.pollstar.com/global/All/100/${encodeURIComponent(search.trim())}`);
        return result && result.response ? result : null;
      });
    }
    return reply(400, { error: "give search or city" });
  } catch (e) {
    console.error("pollstar-city:", e instanceof Error ? e.message : e);
    return reply(503, { unavailable: true });
  }
});
