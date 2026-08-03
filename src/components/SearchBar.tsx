import { useState, useEffect, useRef, type FormEvent } from "react";
import { Settings } from "./Settings";

interface Props {
  onSearch: (query: string) => void;
  loading: boolean;
  prefill: string | null;
  onPrefillConsumed: () => void;
}

export function SearchBar({ onSearch, loading, prefill, onPrefillConsumed }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prefill) {
      setQuery(prefill);
      onPrefillConsumed();
      setHighlight(true);
      inputRef.current?.focus();
      const timer = setTimeout(() => setHighlight(false), 800);
      return () => clearTimeout(timer);
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
      <div style={styles.title}>MusicSceneMap</div>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search an artist (e.g. Ty Segall, Osees, King Gizzard)"
        disabled={loading}
        style={{
          ...styles.input,
          ...(highlight ? styles.inputHighlight : {}),
        }}
        aria-label="Search artists"
      />
      <button type="submit" disabled={loading || !query.trim()} style={styles.button}>
        {loading ? "Loading…" : "Expand"}
      </button>
      <Settings onKeyChange={() => {}} />
    </form>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderBottom: "1px solid #2a2a2a",
    background: "#1a1a1a",
  },
  title: {
    fontWeight: 700,
    fontSize: "1.1rem",
    color: "#ff6b6b",
    whiteSpace: "nowrap",
  },
  input: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    borderRadius: "4px",
    border: "1px solid #444",
    background: "#2a2a2a",
    color: "#e0e0e0",
    fontSize: "0.9rem",
    transition: "border-color 0.3s, box-shadow 0.3s",
  },
  inputHighlight: {
    borderColor: "#ff6b6b",
    boxShadow: "0 0 8px rgba(255, 107, 107, 0.4)",
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
};
