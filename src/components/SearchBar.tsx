import { useState, useEffect, useRef, type FormEvent } from "react";
import { Settings } from "./Settings";

interface Props {
  onSearch: (query: string) => void;
  loading: boolean;
  prefill: string | null;
  onPrefillConsumed: () => void;
  onReset: () => void;
}

export function SearchBar({ onSearch, loading, prefill, onPrefillConsumed, onReset }: Props) {
  const [query, setQuery] = useState("");
  const [highlightKey, setHighlightKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prefill) {
      setQuery(prefill);
      onPrefillConsumed();
      setHighlightKey((k) => k + 1);
    }
  }, [prefill, onPrefillConsumed]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      onSearch(trimmed);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div className="header-title" style={styles.title}>MusicSceneMap</div>
      <div className="search-group" style={styles.searchGroup}>
        <input
          key={highlightKey}
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an artist (e.g. Ty Segall, Osees, King Gizzard)"
          disabled={loading}
          className={highlightKey > 0 ? "search-input-highlight" : ""}
          style={styles.input}
          aria-label="Search artists"
        />
        <button type="submit" disabled={loading || !query.trim()} style={styles.button}>
          {loading ? "Loading…" : "Expand"}
        </button>
      </div>
      <button type="button" onClick={onReset} style={styles.resetBtn} title="Clear graph">
        Reset
      </button>
      <Settings onKeyChange={() => {}} />
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid #2a2a2a",
    background: "#1a1a1a",
    flexWrap: "wrap",
  },
  title: {
    fontWeight: 700,
    fontSize: "1.1rem",
    color: "#ff6b6b",
    whiteSpace: "nowrap",
  },
  searchGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flex: "1 1 250px",
    minWidth: "0",
  },
  input: {
    flex: "1 1 0",
    minWidth: "0",
    padding: "0.5rem 0.75rem",
    borderRadius: "4px",
    border: "1px solid #444",
    background: "#2a2a2a",
    color: "#e0e0e0",
    fontSize: "16px",
  },
  button: {
    padding: "0.5rem 1rem",
    borderRadius: "4px",
    border: "none",
    background: "#ff6b6b",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  resetBtn: {
    padding: "0.5rem 0.75rem",
    borderRadius: "4px",
    border: "1px solid #444",
    background: "transparent",
    color: "#888",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.8rem",
  },
};
