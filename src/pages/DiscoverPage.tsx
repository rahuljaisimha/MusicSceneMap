import { useState } from "react";
import { searchVenuesForArtists, type VenueResult } from "../api/supabase";

export function DiscoverPage() {
  const [city, setCity] = useState("");
  const [artistInput, setArtistInput] = useState("");
  const [artists, setArtists] = useState<string[]>([]);
  const [results, setResults] = useState<Array<VenueResult & { artists: string[] }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddArtist = () => {
    const trimmed = artistInput.trim();
    if (trimmed && !artists.includes(trimmed)) {
      setArtists([...artists, trimmed]);
      setArtistInput("");
    }
  };

  const handleRemoveArtist = (name: string) => {
    setArtists(artists.filter((a) => a !== name));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddArtist();
    }
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

      // Phase 2: Find connected bands via BFS in SQLite (no hop limit, cap at 15 groups)
      const { getDb, findNodeByName, getNeighbors } = await import("../db/graphDb");
      try {
        await getDb();
      } catch {
        return;
      }

      const connectedBands = new Set<string>();
      const visited = new Set<string>();
      const queue: string[] = [];

      // Start BFS from user's artists
      for (const artist of artists) {
        const node = findNodeByName(artist);
        if (node && !visited.has(node.id)) {
          visited.add(node.id);
          queue.push(node.id);
        }
      }

      // BFS until we find 15 groups
      while (queue.length > 0 && connectedBands.size < 5) {
        const nodeId = queue.shift()!;
        const neighbors = getNeighbors(nodeId);

        for (const { node: neighbor, relType } of neighbors) {
          if (visited.has(neighbor.id)) continue;
          if (neighbor.type === "album") continue;
          if (relType !== "member_of" && relType !== "former_member_of" && relType !== "support_musician") continue;

          visited.add(neighbor.id);
          queue.push(neighbor.id);

          if (neighbor.type === "group" && !artists.includes(neighbor.name)) {
            connectedBands.add(neighbor.name);
            if (connectedBands.size >= 5) break;
          }
        }
      }

      if (connectedBands.size === 0) return;

      // Phase 2: Fetch venues for connected bands (in batches of 5)
      const bands = [...connectedBands];
      const batchSize = 5;

      for (let i = 0; i < bands.length; i += batchSize) {
        const batch = bands.slice(i, i + batchSize);
        const batchResults = await searchVenuesForArtists(batch, cityName);

        // Merge with existing results
        setResults((prev) => {
          if (!prev) return batchResults;
          const merged = new Map<string, (typeof prev)[0]>();

          // Add existing
          for (const v of prev) {
            merged.set(v.venue, { ...v });
          }

          // Merge new
          for (const v of batchResults) {
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

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Discover Venues</h1>
          <p style={styles.subtitle}>
            Find venues in a city based on artists you like.
          </p>
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
              <input
                type="text"
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add an artist..."
                style={styles.input}
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
                      style={styles.chipRemove}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleSearch}
            disabled={loading || !city.trim() || artists.length === 0}
            style={styles.searchBtn}
          >
            {loading ? "Searching…" : "Find Venues"}
          </button>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {results && results.length === 0 && (
          <p style={styles.noResults}>No venues found for these artists in {city}.</p>
        )}

        {results && results.length > 0 && (
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
      </div>
    </div>
  );
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
  addBtn: { padding: "0.5rem 1rem", borderRadius: "4px", border: "none", background: "#48dbfb", color: "#000", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  chipList: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" },
  chip: { display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.6rem", borderRadius: "12px", background: "#2a2a2a", color: "#e0e0e0", fontSize: "0.8rem", border: "1px solid #444" },
  chipRemove: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: 0 },
  searchBtn: { padding: "0.6rem 1.25rem", borderRadius: "4px", border: "none", background: "#ff6b6b", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" },
  error: { color: "#ff6b6b", fontSize: "0.85rem" },
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
