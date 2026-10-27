/**
 * User-requested data: what the app fetches from outside sources because a
 * user asked for something (a venue's upcoming shows, an artist's setlists in a
 * city, ...), kept in the user_requested_data table (migration 009) so
 * concert-database (concertdb/msm_requested.py) can store it like its own
 * crawls. Nothing kept is about the user.
 *
 * Browsers hand data to the user-requested-data function, which anyone can
 * call, so each source has a check here that keeps only the fields
 * concert-database reads and refuses anything malformed. Pure: shared by the
 * edge functions (Deno) and the app's tests (Vitest).
 *
 * Sources a browser can hand in (BROWSER_SOURCES):
 *   pollstar   { venue, events: <Pollstar events response> } -> key = the venue id
 * Kept server-side by an edge function itself (not through the browser):
 *   setlistfm  a setlist as setlist.fm returned it (venue-search) -> key = the setlist id
 */

/** One row of user_requested_data. `version` changes when the data does. */
export interface RequestedRow {
  source: string;
  key: string;
  data: unknown;
  version: string;
}

export interface KeptVenue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  location: string | null;
}

export interface KeptEvent {
  id: string;
  name: string | null;
  playDate: string;
  url: string | null;
  isFestival: boolean;
  venue: { id: string };
  artists: Array<{ name: string; isHeadline: boolean }>;
}

export const MAX_EVENTS = 100;
export const MAX_ARTISTS = 60;
const MAX_TEXT = 300;
const ID = /^\d{1,12}$/;
const PLAY_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

function text(v: unknown, required: boolean): string | null {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error("missing text");
    return null;
  }
  if (typeof v !== "string" || v.length > MAX_TEXT) throw new Error("bad text");
  return v;
}

function pollstarUrl(v: unknown): string | null {
  const s = text(v, false);
  if (s === null) return null;
  const u = new URL(s);
  if (u.protocol !== "https:" || !/(^|\.)pollstar\.com$/.test(u.hostname)) throw new Error("bad url");
  return u.toString();
}

/** A Pollstar venue and its events as kept, or throws Error with a short reason. */
export function sanitizePollstar(body: unknown): { venue: KeptVenue; events: KeptEvent[] } {
  const b = body as { venue?: Record<string, unknown>; events?: { events?: unknown } };
  const v = b?.venue;
  if (!v || typeof v !== "object") throw new Error("missing venue");
  const venueId = String(v.id ?? "");
  if (!ID.test(venueId)) throw new Error("bad venue id");
  const venue: KeptVenue = {
    id: venueId,
    name: text(v.name, true)!,
    city: text(v.city, false),
    state: text(v.state, false),
    location: text(v.location, false),
  };

  const raw = b.events?.events;
  if (!Array.isArray(raw)) throw new Error("missing events");
  if (raw.length > MAX_EVENTS) throw new Error("too many events");
  const events = raw.map((e: Record<string, unknown>): KeptEvent => {
    const id = String(e?.id ?? "");
    if (!ID.test(id)) throw new Error("bad event id");
    const playDate = text(e.playDate, true)!;
    if (!PLAY_DATE.test(playDate)) throw new Error("bad playDate");
    const ev = e.venue as { id?: unknown } | undefined;
    if (ev?.id !== undefined && String(ev.id) !== venueId) throw new Error("event at another venue");
    const artists = Array.isArray(e.artists) ? e.artists : [];
    if (artists.length > MAX_ARTISTS) throw new Error("too many artists");
    return {
      id,
      name: text(e.name, false),
      playDate,
      url: pollstarUrl(e.url),
      isFestival: e.isFestival === true,
      venue: { id: venueId },
      artists: artists
        .map((a: Record<string, unknown>) => ({ name: text(a?.name, false) ?? "", isHeadline: a?.isHeadline === true }))
        .filter((a) => a.name.trim() !== ""),
    };
  });
  return { venue, events };
}

/** Each browser source's check: the request body's `data` -> the row to keep (version = a hash, filled in by the function). */
export const BROWSER_SOURCES: Record<string, (data: unknown) => Omit<RequestedRow, "version">> = {
  pollstar: (data) => {
    const kept = sanitizePollstar(data);
    return { source: "pollstar", key: kept.venue.id, data: { venue: kept.venue, events: kept.events } };
  },
};

/** The row for a request body { source, data }, or throws Error with a short reason. */
export function requestedRow(body: unknown): Omit<RequestedRow, "version"> {
  const source = (body as { source?: unknown })?.source;
  const check = typeof source === "string" && Object.prototype.hasOwnProperty.call(BROWSER_SOURCES, source) ? BROWSER_SOURCES[source] : undefined;
  if (!check) throw new Error("unknown source");
  return check((body as { data?: unknown }).data);
}
