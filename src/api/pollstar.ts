/**
 * Pollstar client (browser-side).
 *
 * Pollstar has a paid API, but its website backs onto public JSON endpoints we
 * can read for upcoming events. We keep usage polite:
 *   - pace requests at ~1 req/sec (relaxable via MIN_REQUEST_INTERVAL_MS)
 *   - send a realistic browser User-Agent (dev proxy / CORS proxy forwards it)
 *   - cache responses for 24h (results must stay fresh, but not hammer Pollstar)
 *
 * Endpoints (observed):
 *   Autocomplete: https://autocomplete.pollstar.com/global/All/100/{query}
 *     → { response: { docs: [{ EntityId, ListName, City, State, Location,
 *                              EntityType, Rank, ... }] } }
 *   Events:       https://www.pollstar.com/api/companies/{venueId}/events
 *                   ?page=&pageSize=&fromDate=MM-DD-YYYY&toDate=MM-DD-YYYY
 *                   &sortAscending=true&sortColumn=playdate&newOnly=false
 *     → { totalPages, totalEvents, events: [{ id, name, playDate, url,
 *          isFestival, venue{...}, artists:[{ name, isHeadline, genres,
 *          artistType }], tickets:[{ name, url, time }] }] }
 *     NOTE: fromDate MUST be today-or-later; past dates are subscription-gated.
 *
 * CORS: Pollstar sends no Access-Control-Allow-Origin header (same as
 * Setlist.fm). In dev we use Vite proxies; in prod a public CORS proxy.
 */

import { cachedFetch } from "./cache";
import { keepUserRequestedData } from "./supabase";
import { debugLog } from "../debug/DebugLog";

const isDev = import.meta.env.DEV;

/** 24h cache TTL — results stay fresh within a day. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimum gap between Pollstar requests. Relaxable later. */
const MIN_REQUEST_INTERVAL_MS = 1000;

// --- Request pacing ---------------------------------------------------------
// Serialize Pollstar requests through a promise chain so they fire one after
// another spaced by MIN_REQUEST_INTERVAL_MS — but the FIRST request starts
// immediately (no upfront delay).

let pacingChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = pacingChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  // Advance the chain regardless of success/failure so one error can't stall it.
  pacingChain = run.catch(() => {});
  return run.then(fn);
}

// --- URL construction (dev proxy vs prod CORS proxy) ------------------------

function autocompleteUrl(query: string): string {
  const path = `/global/All/100/${encodeURIComponent(query)}`;
  if (isDev) return `/pollstar-ac${path}`;
  return `https://corsproxy.io/?url=${encodeURIComponent(`https://autocomplete.pollstar.com${path}`)}`;
}

function eventsUrl(venueId: string, qs: string): string {
  const path = `/api/companies/${venueId}/events?${qs}`;
  if (isDev) return `/pollstar-api${path}`;
  return `https://corsproxy.io/?url=${encodeURIComponent(`https://www.pollstar.com${path}`)}`;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function pollstarFetch<T>(url: string): Promise<T> {
  const response = await paced(() =>
    fetch(url, { headers: { Accept: "application/json", "User-Agent": BROWSER_UA } })
  );
  if (!response.ok) {
    throw new Error(`Pollstar request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

// --- Types ------------------------------------------------------------------

export interface PollstarVenue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  location: string | null;
  /** Pollstar prominence rank (higher = more prominent). */
  rank: number;
}

export interface PollstarEventArtist {
  name: string;
  isHeadline: boolean;
  genres: string[];
  artistType: string | null;
}

export interface PollstarTicket {
  name: string;
  url: string;
  time: string | null;
}

export interface PollstarEvent {
  id: string;
  name: string;
  /** ISO date (playDate). */
  playDate: string;
  url: string | null;
  isFestival: boolean;
  venueId: string;
  venueName: string;
  artists: PollstarEventArtist[];
  tickets: PollstarTicket[];
}

// --- Raw response shapes (partial) ---

interface RawAutocomplete {
  response?: { docs?: RawAcDoc[] };
}
interface RawAcDoc {
  EntityId: string;
  ListName: string;
  EntityType: string;
  City?: string;
  State?: string;
  Location?: string;
  Rank?: number;
}
interface RawEventsResponse {
  totalPages?: number;
  totalEvents?: number;
  events?: RawEvent[];
}
interface RawEvent {
  id: number | string;
  name: string;
  playDate: string;
  url?: string | null;
  isFestival?: boolean;
  venue?: { id?: number | string; name?: string };
  artists?: Array<{ name: string; isHeadline?: boolean; genres?: string[]; artistType?: string | null }>;
  tickets?: Array<{ name?: string; url?: string; time?: string | null }>;
}

// --- Parsing (pure, exported for tests) -------------------------------------

/** Parse the autocomplete response into venues only (drops artists/cities). */
export function parseVenues(raw: RawAutocomplete): PollstarVenue[] {
  const docs = raw.response?.docs ?? [];
  return docs
    .filter((d) => d.EntityType === "Venue")
    .map((d) => ({
      id: String(d.EntityId),
      name: d.ListName,
      city: d.City ?? null,
      state: d.State ?? null,
      location: d.Location ?? null,
      rank: d.Rank ?? 0,
    }));
}

/** Parse the events response into a flat list of events. */
export function parseEvents(raw: RawEventsResponse): PollstarEvent[] {
  const events = raw.events ?? [];
  return events.map((e) => ({
    id: String(e.id),
    name: e.name,
    playDate: e.playDate,
    url: e.url ?? null,
    isFestival: Boolean(e.isFestival),
    venueId: e.venue?.id != null ? String(e.venue.id) : "",
    venueName: e.venue?.name ?? "",
    artists: (e.artists ?? []).map((a) => ({
      name: a.name,
      isHeadline: Boolean(a.isHeadline),
      genres: a.genres ?? [],
      artistType: a.artistType ?? null,
    })),
    tickets: (e.tickets ?? [])
      .filter((t): t is { name: string; url: string; time?: string | null } => Boolean(t.url))
      .map((t) => ({ name: t.name ?? "Tickets", url: t.url, time: t.time ?? null })),
  }));
}

/** Format a Date as MM-DD-YYYY (Pollstar's expected format). */
export function formatPollstarDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

// --- Public API -------------------------------------------------------------

/** Search Pollstar venues by name, ranked by prominence (highest first). */
export async function searchVenues(query: string): Promise<PollstarVenue[]> {
  const key = `pollstar_ac_${query.toLowerCase()}`;
  return cachedFetch(
    key,
    async () => {
      debugLog.log(`Pollstar autocomplete: "${query}"`);
      const raw = await pollstarFetch<RawAutocomplete>(autocompleteUrl(query));
      const venues = parseVenues(raw).sort((a, b) => b.rank - a.rank);
      debugLog.log(`Pollstar: ${venues.length} venues for "${query}"`);
      return venues;
    },
    CACHE_TTL_MS
  );
}

/**
 * Fetch upcoming events for a venue (from today out to `yearsAhead` years).
 * `fromDate` is always today-or-later (Pollstar gates past dates). With
 * `venue`, a fresh response (not a cached one) is also kept as user-requested
 * data for concert-database.
 */
export async function getUpcomingEvents(
  venueId: string,
  opts: { pageSize?: number; yearsAhead?: number; venue?: PollstarVenue } = {}
): Promise<PollstarEvent[]> {
  const pageSize = opts.pageSize ?? 25;
  const yearsAhead = opts.yearsAhead ?? 4;

  const today = new Date();
  const from = formatPollstarDate(today);
  const toDate = new Date(today);
  toDate.setFullYear(toDate.getFullYear() + yearsAhead);
  const to = formatPollstarDate(toDate);

  const key = `pollstar_events_${venueId}_${from}`;
  return cachedFetch(
    key,
    async () => {
      const qs = new URLSearchParams({
        page: "0",
        pageSize: String(pageSize),
        fromDate: from,
        toDate: to,
        sortAscending: "true",
        sortColumn: "playdate",
        newOnly: "false",
      }).toString();
      debugLog.log(`Pollstar events: venue ${venueId} from ${from}`);
      const raw = await pollstarFetch<RawEventsResponse>(eventsUrl(venueId, qs));
      if (opts.venue) {
        const { id, name, city, state, location } = opts.venue;
        keepUserRequestedData("pollstar", { venue: { id, name, city, state, location }, events: raw });
      }
      const events = parseEvents(raw);
      debugLog.log(`Pollstar: ${events.length} upcoming events for venue ${venueId}`);
      return events;
    },
    CACHE_TTL_MS
  );
}
