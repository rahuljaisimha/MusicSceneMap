import { useState } from "react";
import { searchVenuesForArtists, searchVenuesByMbid, type VenueResult } from "../api/supabase";
import { searchVenues as pollstarSearchVenues, getUpcomingEvents, type PollstarEvent } from "../api/pollstar";
import { buildTieredGraphAccess } from "./tieredGraphAccess";
import { rankConcerts, dedupeEvents, headlineArtist, type RankedConcert } from "./concerts";
import { SpotifyImportButton } from "../components/SpotifyImportButton";
import { ArtistAutocomplete } from "../components/ArtistAutocomplete";
import { DISCOVER_REL_OPTIONS, DEFAULT_DISCOVER_RELS, findConnectedBands } from "./relatedBands";

type DiscoverMode = "venues" | "concerts";

/** How many top venues to pull concerts from. */
const CONCERT_VENUE_LIMIT = 8;

/** Remembers which relationship types the viewer ticked (this browser only). */
const REL_TYPES_KEY = "discover.relTypes";

function loadRelTypes(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(REL_TYPES_KEY) ?? "null");
    const known = new Set(DISCOVER_REL_OPTIONS.map((o) => o.relType));
    if (Array.isArray(saved)) return saved.filter((t): t is string => typeof t === "string" && known.has(t));
  } catch {
    /* no storage: defaults */
  }
  return DEFAULT_DISCOVER_RELS;
}

export function DiscoverPage() {
  const [mode, setMode] = useState<DiscoverMode>("venues");
  const [city, setCity] = useState("");
  const [artistInput, setArtistInput] = useState("");
  const [artists, setArtists] = useState<string[]>([]);
  const [results, setResults] = useState<Array<VenueResult & { artists: string[] }> | null>(null);
  const [concerts, setConcerts] = useState<RankedConcert[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relTypes, setRelTypes] = useState<string[]>(loadRelTypes);

  const toggleRelType = (relType: string) => {
    const next = relTypes.includes(relType) ? relTypes.filter((t) => t !== relType) : [...relTypes, relType];
    setRelTypes(next);
    try {
      localStorage.setItem(REL_TYPES_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };

  const addArtist = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!artists.includes(trimmed)) setArtists([...artists, trimmed]);
    setArtistInput("");
  };

  const handleAddArtist = () => addArtist(artistInput);

  const handleRemoveArtist = (name: string) => {
    setArtists(artists.filter((a) => a !== name));
  };

  const handleSearch = async () => {
    if (!city.trim() || artists.length === 0) return;
    setLoading(true);
    setError(null);
    setResults(null);

    const cityName = city.trim();

    try {
      // Phase 1: Search for the artists the user typed (immediate results)
      const directResults = await searchVenuesForArtists(artists, cityName);
      setResults(directResults);
      setLoading(false);

      // Phase 2: Find connected bands via BFS over the graph. Doesn't wait for
      // the graph download: until it's loaded, graphSource asks the server.
      const { isDbLoaded } = await import("../db/graphDb");
      const { findArtist, getArtistNeighbors } = await import("../db/graphSource");
      const { reportMiss } = await import("../api/supabase");

      // Captured before the lookups: if they went to the server, their misses
      // say nothing about SQLite coverage, even if the download finishes meanwhile.
      const lookedUpLocally = isDbLoaded();
      const startNodes = await Promise.all(artists.map((artist) => findArtist(artist).catch(() => null)));

      // Report artists missing from SQLite (for future SQLite updates). Only
      // when checked against the local graph; skipped while it's downloading.
      if (lookedUpLocally) {
        artists.forEach((artist, i) => {
          if (!startNodes[i]) reportMiss(artist, "sqlite-missing");
        });
      }

      // BFS over the ticked relationship types until we find 5 groups. While the
      // graph is still downloading each step is a server request, so cap how
      // many nodes those expand.
      const MAX_REMOTE_EXPANSIONS = 30;
      let remoteExpansions = 0;
      const connectedBands = await findConnectedBands({
        startIds: startNodes.filter((n): n is NonNullable<typeof n> => Boolean(n)).map((n) => n.id),
        exclude: artists,
        relTypes,
        neighbors: getArtistNeighbors,
        limit: 5,
        canExpand: () => isDbLoaded() || remoteExpansions++ < MAX_REMOTE_EXPANSIONS,
      });

      if (connectedBands.length === 0) return;

      // Phase 2: Fetch venues for connected bands by MBID (in batches of 5)
      const bands = connectedBands;
      const batchSize = 5;

      for (let i = 0; i < bands.length; i += batchSize) {
        const batch = bands.slice(i, i + batchSize);
        const batchPromises = batch.map((b) =>
          searchVenuesByMbid(b.mbid, cityName).then((r) => ({ ...r, artistName: b.name }))
        );
        const batchSettled = await Promise.allSettled(batchPromises);

        const batchVenues: Array<VenueResult & { artists: string[] }> = [];
        for (const result of batchSettled) {
          if (result.status !== "fulfilled") continue;
          const { venues, artistName } = result.value;
          for (const v of venues) {
            batchVenues.push({ ...v, artists: [artistName] });
          }
        }

        // Merge with existing results
        setResults((prev) => {
          if (!prev) return batchVenues;
          const merged = new Map<string, (typeof prev)[0]>();

          // Add existing
          for (const v of prev) {
            merged.set(v.venue, { ...v });
          }

          // Merge new
          for (const v of batchVenues) {
            const existing = merged.get(v.venue);
            if (existing) {
              existing.showCount += v.showCount;
              for (const a of v.artists) {
                if (!existing.artists.includes(a)) {
                  existing.artists.push(a);
                }
              }
            } else {
              merged.set(v.venue, { ...v });
            }
          }

          return [...merged.values()].sort((a, b) => b.showCount - a.showCount);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLoading(false);
    }
  };

  /**
   * Concerts flow: find the top venues in the city (reusing the venue search),
   * resolve each to a Pollstar venue, fetch upcoming events, and rank every
   * concert by how similar its headline artist is to the user's list.
   * Pollstar requests are paced ~1/sec inside the client; the first fires ASAP.
   */
  const handleFindConcerts = async () => {
    if (!city.trim() || artists.length === 0) return;
    setLoading(true);
    setError(null);
    setConcerts(null);

    const cityName = city.trim();

    try {
      // 1. Top venues in the city (from the existing Setlist.fm-backed search).
      const venueResults = await searchVenuesForArtists(artists, cityName);
      const topVenueNames = venueResults.slice(0, CONCERT_VENUE_LIMIT).map((v) => v.venue);

      // 2. Resolve each venue name to a Pollstar venue in the same city.
      const cityLower = cityName.toLowerCase();
      const pollstarVenueIds = new Map<string, string>(); // id -> name (dedupe)
      for (const name of topVenueNames) {
        try {
          const matches = await pollstarSearchVenues(name);
          const inCity = matches.find(
            (m) => (m.city ?? "").toLowerCase() === cityLower || (m.location ?? "").toLowerCase().includes(cityLower)
          );
          const chosen = inCity ?? matches[0];
          if (chosen && !pollstarVenueIds.has(chosen.id)) {
            pollstarVenueIds.set(chosen.id, chosen.name);
          }
        } catch {
          // Skip venues Pollstar can't resolve.
        }
      }

      if (pollstarVenueIds.size === 0) {
        setConcerts([]);
        setLoading(false);
        return;
      }

      // 3. Fetch upcoming events for each resolved venue.
      const allEvents: PollstarEvent[] = [];
      for (const venueId of pollstarVenueIds.keys()) {
        try {
          const events = await getUpcomingEvents(venueId);
          allEvents.push(...events);
        } catch {
          // Skip venues whose events fail to load.
        }
      }

      // 4. Rank by headline-artist similarity to the taste list (graph-based).
      const events = dedupeEvents(allEvents);
      const tiered = await buildTieredGraphAccess();
      // Prefetch out-of-core artists (concert headliners are often small artists
      // missing from the core graph) plus the user's list, via Tier 2/3.
      const headliners = events
        .map((e) => headlineArtist(e))
        .filter((n): n is string => Boolean(n));
      await tiered.prepareArtists([...new Set([...artists, ...headliners])]);
      const ranked = rankConcerts(tiered.build(), events, artists);
      setConcerts(ranked);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (mode === "venues") handleSearch();
    else handleFindConcerts();
  };

  return (
    <div style={styles.page}>
      <div className="page-container" style={styles.container}>
        <div style={styles.header}>
          <h1 className="page-title" style={styles.title}>{mode === "venues" ? "Discover Venues" : "Discover Concerts"}</h1>
          <p style={styles.subtitle}>
            {mode === "venues"
              ? "Find venues in a city based on artists you like."
              : "Find upcoming concerts at a city's top venues, ranked by how well the artist fits your taste."}
          </p>
        </div>

        <div style={styles.toggle}>
          <button
            type="button"
            onClick={() => setMode("venues")}
            style={{ ...styles.toggleBtn, ...(mode === "venues" ? styles.toggleActive : {}) }}
          >
            Venues
          </button>
          <button
            type="button"
            onClick={() => setMode("concerts")}
            style={{ ...styles.toggleBtn, ...(mode === "concerts" ? styles.toggleActive : {}) }}
          >
            Concerts
          </button>
        </div>

        <div style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Los Angeles, London, Melbourne"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Artists</label>
            <div style={styles.inputRow}>
              <ArtistAutocomplete
                value={artistInput}
                onChange={setArtistInput}
                onSelect={(a) => addArtist(a.name)}
                onEnter={handleAddArtist}
                placeholder="Add an artist..."
                inputStyle={styles.input}
                wrapperStyle={styles.autocomplete}
                ariaLabel="Add an artist"
              />
              <button
                type="button"
                onClick={handleAddArtist}
                disabled={!artistInput.trim()}
                style={styles.addBtn}
              >
                Add
              </button>
            </div>
            {artists.length > 0 && (
              <div style={styles.chipList}>
                {artists.map((a) => (
                  <span key={a} style={styles.chip}>
                    {a}
                    <button
                      type="button"
                      onClick={() => handleRemoveArtist(a)}
                      className="chip-remove"
                      style={styles.chipRemove}
                      aria-label={`Remove ${a}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <SpotifyImportButton artists={artists} onChange={setArtists} />
          </div>

          {mode === "venues" && (
            <fieldset className="rel-toggles" style={styles.relFieldset}>
              <legend style={{ ...styles.label, marginBottom: "0.4rem" }}>Also find related bands through</legend>
              <div style={styles.relList}>
                {DISCOVER_REL_OPTIONS.map((o) => (
                  <label key={o.relType} className="rel-toggle" style={styles.relOption}>
                    <input
                      type="checkbox"
                      checked={relTypes.includes(o.relType)}
                      onChange={() => toggleRelType(o.relType)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              {relTypes.length === 0 && (
                <p style={styles.relNote}>Nothing ticked: only your artists' venues are shown.</p>
              )}
            </fieldset>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !city.trim() || artists.length === 0}
            style={styles.searchBtn}
          >
            {loading
              ? mode === "venues" ? "Searching…" : "Finding concerts…"
              : mode === "venues" ? "Find Venues" : "Find Concerts"}
          </button>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {mode === "venues" && results && results.length === 0 && (
          <p style={styles.noResults}>No venues found for these artists in {city}.</p>
        )}

        {mode === "venues" && results && results.length > 0 && (
          <div style={styles.results}>
            <h2 style={styles.resultsTitle}>
              Venues in {city} ({results.length})
            </h2>
            {results.map((v, i) => (
              <div key={`${v.venue}-${i}`} style={styles.venueCard}>
                <div style={styles.venueHeader}>
                  <span style={styles.venueName}>{v.venue}</span>
                  <span style={styles.showCount}>{v.showCount} shows</span>
                </div>
                <div style={styles.venueArtists}>
                  {v.artists.map((a) => (
                    <span key={a} style={styles.artistTag}>{a}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {mode === "concerts" && concerts && concerts.length === 0 && (
          <p style={styles.noResults}>No upcoming concerts found at {city}'s top venues.</p>
        )}

        {mode === "concerts" && concerts && concerts.length > 0 && (
          <div style={styles.results}>
            <h2 style={styles.resultsTitle}>
              Upcoming concerts in {city} ({concerts.length})
            </h2>
            {concerts.map((c) => (
              <div key={c.id} style={styles.venueCard}>
                <div style={styles.venueHeader}>
                  <span style={styles.venueName}>{c.artistName}</span>
                  {c.artistFound ? (
                    <span style={{ ...styles.showCount, color: scoreColor(c.score) }}>
                      {c.score}% match
                    </span>
                  ) : (
                    <span style={styles.notFound}>not in graph</span>
                  )}
                </div>
                <div style={styles.concertMeta}>
                  {formatDate(c.playDate)} · {c.venueName}
                  {c.isFestival ? " · Festival" : ""}
                </div>
                {c.supportingArtists.length > 0 && (
                  <div style={styles.venueArtists}>
                    {c.supportingArtists.slice(0, 6).map((a) => (
                      <span key={a} style={styles.artistTag}>{a}</span>
                    ))}
                  </div>
                )}
                {c.tickets.length > 0 && (
                  <div style={styles.ticketRow}>
                    {c.tickets.map((t, ti) => (
                      <a
                        key={ti}
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.ticketLink}
                      >
                        {t.name}{t.time ? ` · ${t.time}` : ""}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Format an ISO play date as a readable local date. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function scoreColor(score: number): string {
  if (score >= 70) return "#55efc4";
  if (score >= 40) return "#feca57";
  if (score >= 15) return "#ff9f43";
  return "#636e72";
}

const styles: Record<string, React.CSSProperties> = {
  page: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  toggle: { display: "flex", gap: "0.25rem", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "0.25rem" },
  toggleBtn: { padding: "0.4rem 1.1rem", borderRadius: "4px", border: "none", background: "transparent", color: "#888", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" },
  toggleActive: { background: "#ff6b6b", color: "#fff" },
  notFound: { fontSize: "0.72rem", color: "#636e72", fontStyle: "italic" },
  concertMeta: { fontSize: "0.8rem", color: "#aaa", marginBottom: "0.4rem" },
  ticketRow: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" },
  ticketLink: { fontSize: "0.75rem", color: "#48dbfb", textDecoration: "none", border: "1px solid rgba(72, 219, 251, 0.3)", borderRadius: "10px", padding: "0.15rem 0.6rem" },
  container: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "1.5rem", overflowY: "auto", gap: "1.25rem" },
  header: { textAlign: "center" },
  title: { fontSize: "1.6rem", fontWeight: 700, color: "#e0e0e0", marginBottom: "0.25rem" },
  subtitle: { color: "#888", fontSize: "0.9rem" },
  form: { display: "flex", flexDirection: "column", gap: "1rem", width: "100%", maxWidth: "450px" },
  field: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  label: { fontSize: "0.8rem", fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.03em" },
  input: { padding: "0.5rem 0.75rem", borderRadius: "4px", border: "1px solid #444", background: "#2a2a2a", color: "#e0e0e0", fontSize: "16px" },
  inputRow: { display: "flex", gap: "0.5rem" },
  autocomplete: { flex: 1 },
  addBtn: { padding: "0.5rem 1rem", borderRadius: "4px", border: "none", background: "#48dbfb", color: "#000", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  chipList: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" },
  chip: { display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.6rem", borderRadius: "12px", background: "#2a2a2a", color: "#e0e0e0", fontSize: "0.8rem", border: "1px solid #444" },
  chipRemove: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: 0 },
  searchBtn: { padding: "0.6rem 1.25rem", borderRadius: "4px", border: "none", background: "#ff6b6b", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" },
  error: { color: "#ff6b6b", fontSize: "0.85rem" },
  relFieldset: { border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" },
  relList: { display: "flex", flexWrap: "wrap", gap: "0.25rem 1rem" },
  relOption: { display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", color: "#ccc", cursor: "pointer" },
  relNote: { fontSize: "0.75rem", color: "#888", margin: 0 },
  noResults: { color: "#888", fontSize: "0.9rem" },
  results: { width: "100%", maxWidth: "450px" },
  resultsTitle: { fontSize: "1.1rem", fontWeight: 600, color: "#e0e0e0", marginBottom: "0.75rem" },
  venueCard: { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "0.75rem", marginBottom: "0.5rem" },
  venueHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" },
  venueName: { fontWeight: 600, color: "#e0e0e0", fontSize: "0.95rem" },
  showCount: { color: "#55efc4", fontSize: "0.8rem", fontWeight: 600 },
  venueArtists: { display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  artistTag: { padding: "0.15rem 0.5rem", borderRadius: "10px", fontSize: "0.7rem", background: "rgba(254, 202, 87, 0.15)", color: "#feca57", border: "1px solid rgba(254, 202, 87, 0.3)" },
};
