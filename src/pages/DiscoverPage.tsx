import { useEffect, useRef, useState } from "react";
import { searchCities, getCityEvents } from "../api/pollstar";
import { buildTieredGraphAccess } from "./tieredGraphAccess";
import { scoreArtistsAgainstList } from "./similarity";
import { CITY_PAGE_SIZE, MAX_CITY_PAGES, pickCity, streamConcerts, type ConcertSearchProgress } from "./concertSearch";
import { clampRange, defaultRange, formatRange, isoDate, maxDate, type DateRange } from "./dateRange";
import type { RankedConcert } from "./concerts";
import { ArtistAutocomplete } from "../components/ArtistAutocomplete";
import { addPicked, chipLabel, fromSuggestion, pickedKey, type PickedArtist } from "./pickedArtists";

/** Lets the browser draw (and handle Stop) between scores: each one runs on the main thread. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function DiscoverPage() {
  const [city, setCity] = useState("");
  const [searchedCity, setSearchedCity] = useState("");
  // Today through a week from today, until the user picks other dates
  const [range, setRange] = useState<DateRange>(() => defaultRange());
  const [searchedRange, setSearchedRange] = useState<DateRange | null>(null);
  const [artistInput, setArtistInput] = useState("");
  const [artists, setArtists] = useState<PickedArtist[]>([]);
  const [concerts, setConcerts] = useState<RankedConcert[] | null>(null);
  const [progress, setProgress] = useState<ConcertSearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Each search is a run; Stop (or a new search, or leaving the page) ends the current one.
  const runRef = useRef(0);
  // Headliner scores by liked-artist list, kept across searches on this page
  const scoreCache = useRef(new Map<string, { score: number; found: boolean }>());
  useEffect(() => () => void runRef.current++, []);

  const running = progress !== null && (progress.stage === "city" || progress.stage === "concerts");
  const today = isoDate(new Date());
  const lastDay = maxDate(today);
  const rangeLabel = searchedRange ? formatRange(searchedRange) : "";

  const addArtist = (artist: PickedArtist) => {
    if (!artist.name.trim()) return;
    setArtists(addPicked(artists, artist));
    setArtistInput("");
  };

  const handleAddArtist = () => addArtist({ name: artistInput });

  const handleRemoveArtist = (artist: PickedArtist) => {
    setArtists(artists.filter((a) => pickedKey(a) !== pickedKey(artist)));
  };

  /**
   * The city on Pollstar → its upcoming concerts a page at a time (requests are
   * paced) → each page listed as soon as it arrives, then moved into place once
   * its headliners are scored.
   */
  const handleFindConcerts = async () => {
    if (!city.trim() || artists.length === 0 || running) return;
    const run = ++runRef.current;
    const stopped = () => run !== runRef.current;
    const cityName = city.trim();
    const dates = clampRange(range);
    setRange(dates);
    setSearchedCity(cityName);
    setSearchedRange(dates);
    setError(null);
    setConcerts([]);
    setProgress({ stage: "city", city: null, pagesLoaded: 0, pagesTotal: 0, concertsTotal: 0, scoring: 0 });

    const liked = artists.map(pickedKey).sort().join(",");
    try {
      const tiered = await buildTieredGraphAccess();
      await tiered.prepareArtists(artists);
      await streamConcerts(
        cityName,
        {
          findCity: async (query) => pickCity(await searchCities(query), query),
          cityEvents: (cityId, page) => getCityEvents(cityId, page, dates),
          // A page's headliners together: those missing from the browser graph are
          // fetched at once, then one search from each liked artist scores them all.
          scoreMany: async (headliners) => {
            const scores = new Map<string, { score: number; found: boolean }>();
            const todo = headliners.filter((h) => {
              const cached = scoreCache.current.get(`${liked}|${h.toLowerCase()}`);
              if (cached) scores.set(h, cached);
              return !cached;
            });
            if (todo.length === 0) return scores;
            await tiered.prepareArtists(todo);
            await yieldToBrowser();
            const fresh = await scoreArtistsAgainstList(tiered.build(), todo, artists, yieldToBrowser);
            for (const [h, s] of fresh) {
              scores.set(h, s);
              scoreCache.current.set(`${liked}|${h.toLowerCase()}`, s);
            }
            return scores;
          },
        },
        (update) => {
          setConcerts(update.concerts);
          setProgress(update.progress);
        },
        stopped
      );
    } catch (e) {
      if (stopped()) return;
      setError(e instanceof Error ? e.message : "Unknown error");
      setProgress((p) => (p ? { ...p, stage: "done" } : p));
    }
  };

  const handleStop = () => {
    runRef.current++;
    setProgress((p) => (p ? { ...p, stage: "stopped" } : p));
  };

  return (
    <div style={styles.page}>
      <div className="page-container" style={styles.container}>
        <div style={styles.header}>
          <h1 className="page-title" style={styles.title}>Discover Concerts</h1>
          <p style={styles.subtitle}>
            Find upcoming concerts in a city, ranked by how well the artist fits your taste.
          </p>
        </div>

        <div style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFindConcerts();
              }}
              placeholder="e.g. Los Angeles, London, Melbourne"
              style={styles.input}
            />
          </div>

          <div style={styles.dates}>
            <label style={{ ...styles.field, ...styles.dateField }}>
              <span style={styles.label}>From</span>
              <input
                type="date"
                value={range.from}
                min={today}
                max={lastDay}
                onChange={(e) => {
                  const from = e.target.value;
                  // Keep the end on or after the start
                  setRange((r) => ({ from, to: from && r.to < from ? from : r.to }));
                }}
                className="date-input"
                style={{ ...styles.input, ...styles.dateInput }}
                aria-label="From date"
              />
            </label>
            <label style={{ ...styles.field, ...styles.dateField }}>
              <span style={styles.label}>To</span>
              <input
                type="date"
                value={range.to}
                min={range.from || today}
                max={lastDay}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="date-input"
                style={{ ...styles.input, ...styles.dateInput }}
                aria-label="To date"
              />
            </label>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Artists you like</label>
            <div style={styles.inputRow}>
              <ArtistAutocomplete
                value={artistInput}
                onChange={setArtistInput}
                onSelect={(a) => addArtist(fromSuggestion(a))}
                onEnter={handleAddArtist}
                placeholder="Add an artist..."
                inputStyle={styles.input}
                wrapperStyle={styles.autocomplete}
                ariaLabel="Add an artist"
              />
              <button type="button" onClick={handleAddArtist} disabled={!artistInput.trim()} style={styles.addBtn}>
                Add
              </button>
            </div>
            {artists.length > 0 && (
              <div style={styles.chipList}>
                {artists.map((a) => (
                  <span key={pickedKey(a)} style={styles.chip} title={a.disambiguation}>
                    {chipLabel(a, artists)}
                    <button
                      type="button"
                      onClick={() => handleRemoveArtist(a)}
                      className="chip-remove"
                      style={styles.chipRemove}
                      aria-label={`Remove ${chipLabel(a, artists)}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {running ? (
            <button type="button" onClick={handleStop} className="discover-stop" style={styles.stopBtn}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFindConcerts}
              disabled={!city.trim() || artists.length === 0}
              style={styles.searchBtn}
            >
              Find Concerts
            </button>
          )}
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {progress && (
          <StatusLine progress={progress} found={concerts?.length ?? 0} query={searchedCity} dates={rangeLabel} />
        )}

        {concerts && concerts.length > 0 && (
          <div style={styles.results} aria-live="polite">
            <h2 style={styles.resultsTitle}>
              Concerts in {progress?.city ?? searchedCity} ({concerts.length})
              <span style={styles.resultsDates}>{rangeLabel}</span>
            </h2>
            {concerts.map((c) => (
              <div key={c.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardName}>{c.artistName}</span>
                  {!c.scored && running ? (
                    <span style={styles.scoring}>
                      <span className="spinner spinner-small" aria-hidden="true" />
                      scoring
                    </span>
                  ) : !c.scored ? (
                    <span style={styles.notFound}>not scored</span>
                  ) : c.artistFound ? (
                    <span style={{ ...styles.match, color: scoreColor(c.score) }}>{c.score}% match</span>
                  ) : (
                    <span style={styles.notFound}>not in graph</span>
                  )}
                </div>
                <div style={styles.concertMeta}>
                  {formatDate(c.playDate)} · {c.venueName}
                  {c.isFestival ? " · Festival" : ""}
                </div>
                {c.supportingArtists.length > 0 && (
                  <div style={styles.tags}>
                    {c.supportingArtists.slice(0, 6).map((a) => (
                      <span key={a} style={styles.artistTag}>{a}</span>
                    ))}
                  </div>
                )}
                {c.tickets.length > 0 && (
                  <div style={styles.ticketRow}>
                    {c.tickets.map((t, ti) => (
                      <a key={ti} href={t.url} target="_blank" rel="noreferrer" style={styles.ticketLink}>
                        {t.name}
                        {t.time ? ` · ${t.time}` : ""}
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

/** Where the search is: a spinner while it runs, then a summary. */
function StatusLine({
  progress,
  found,
  query,
  dates,
}: {
  progress: ConcertSearchProgress;
  found: number;
  query: string;
  dates: string;
}) {
  const { stage, city, pagesLoaded, pagesTotal, concertsTotal, scoring } = progress;
  const running = stage === "city" || stage === "concerts";
  const of = Math.min(concertsTotal, pagesTotal * CITY_PAGE_SIZE);
  let text: string;
  if (stage === "city") text = `Looking up ${query}…`;
  else if (stage === "concerts") {
    const parts = [pagesLoaded === 0 ? `${city}: loading concerts` : `${city}: ${found} of ${of} concerts`];
    if (scoring > 0) parts.push(`scoring ${scoring} artist${scoring === 1 ? "" : "s"}`);
    text = `${parts.join(" · ")}…`;
  } else if (stage === "stopped") text = `Stopped: ${found} of ${of} concerts in ${city ?? query}.`;
  else if (!city) text = `Couldn't find a city called "${query}" on Pollstar.`;
  else if (found === 0) text = `No concerts in ${city}, ${dates}.`;
  // Only "the first" when there were more pages than it loads (a few events have no headliner)
  else if (concertsTotal > MAX_CITY_PAGES * CITY_PAGE_SIZE) text = `The first ${found} of ${concertsTotal} concerts in ${city}, ${dates}.`;
  else text = `All ${found} concerts in ${city}, ${dates}.`;
  return (
    <div style={styles.status} role="status">
      {running && <span className="spinner" aria-hidden="true" />}
      <span>{text}</span>
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
  container: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "1.5rem", overflowY: "auto", gap: "1.25rem" },
  header: { textAlign: "center" },
  title: { fontSize: "1.6rem", fontWeight: 700, color: "#e0e0e0", marginBottom: "0.25rem" },
  subtitle: { color: "#888", fontSize: "0.9rem" },
  form: { display: "flex", flexDirection: "column", gap: "1rem", width: "100%", maxWidth: "450px" },
  field: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  label: { fontSize: "0.8rem", fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.03em" },
  input: { padding: "0.5rem 0.75rem", borderRadius: "4px", border: "1px solid #444", background: "#2a2a2a", color: "#e0e0e0", fontSize: "16px" },
  inputRow: { display: "flex", gap: "0.5rem" },
  dates: { display: "flex", flexWrap: "wrap", gap: "0.75rem" },
  dateField: { flex: "1 1 140px", minWidth: 0 },
  // The page's font, and a light calendar icon on the dark field
  dateInput: { fontFamily: "inherit", colorScheme: "dark" },
  resultsDates: { display: "block", fontSize: "0.8rem", fontWeight: 400, color: "#888", marginTop: "0.15rem" },
  autocomplete: { flex: 1 },
  addBtn: { padding: "0.5rem 1rem", borderRadius: "4px", border: "none", background: "#48dbfb", color: "#000", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  chipList: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" },
  chip: { display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.6rem", borderRadius: "12px", background: "#2a2a2a", color: "#e0e0e0", fontSize: "0.8rem", border: "1px solid #444" },
  chipRemove: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: 0 },
  searchBtn: { padding: "0.6rem 1.25rem", minHeight: "44px", borderRadius: "4px", border: "none", background: "#ff6b6b", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" },
  stopBtn: { padding: "0.6rem 1.25rem", minHeight: "44px", borderRadius: "4px", border: "1px solid #ff6b6b", background: "transparent", color: "#ff6b6b", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" },
  error: { color: "#ff6b6b", fontSize: "0.85rem" },
  status: { display: "flex", alignItems: "center", gap: "0.6rem", color: "#aaa", fontSize: "0.85rem", width: "100%", maxWidth: "450px" },
  results: { width: "100%", maxWidth: "450px" },
  resultsTitle: { fontSize: "1.1rem", fontWeight: 600, color: "#e0e0e0", marginBottom: "0.75rem" },
  card: { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "0.75rem", marginBottom: "0.5rem" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" },
  cardName: { fontWeight: 600, color: "#e0e0e0", fontSize: "0.95rem", minWidth: 0, overflowWrap: "anywhere" },
  match: { fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" },
  scoring: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.72rem", color: "#888", whiteSpace: "nowrap" },
  notFound: { fontSize: "0.72rem", color: "#636e72", fontStyle: "italic", whiteSpace: "nowrap" },
  concertMeta: { fontSize: "0.8rem", color: "#aaa", marginBottom: "0.4rem" },
  tags: { display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  artistTag: { padding: "0.15rem 0.5rem", borderRadius: "10px", fontSize: "0.7rem", background: "rgba(254, 202, 87, 0.15)", color: "#feca57", border: "1px solid rgba(254, 202, 87, 0.3)" },
  ticketRow: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" },
  ticketLink: { fontSize: "0.75rem", color: "#48dbfb", textDecoration: "none", border: "1px solid rgba(72, 219, 251, 0.3)", borderRadius: "10px", padding: "0.15rem 0.6rem" },
};
