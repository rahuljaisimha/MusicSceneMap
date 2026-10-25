import { useEffect, useState } from "react";
import type { GraphNode } from "../graph/types";
import { NODE_COLORS } from "../graph/types";
import { getArtistDetails, getDb, isDbLoaded, type ArtistDetails } from "../db/graphDb";

interface Props {
  node: GraphNode;
  onClose: () => void;
}

/** Names the graph's legend uses for the two artist node types. */
const TYPE_LABELS: Partial<Record<GraphNode["type"], string>> = { artist: "group", musician: "person" };

/** Groups and people come from MusicBrainz: their id is a MusicBrainz artist ID. */
function isMusicBrainzArtist(node: GraphNode): boolean {
  return node.type === "artist" || node.type === "musician";
}

/**
 * An artist's details from the local graph. While the graph is still
 * downloading this is "loading", then fills in; null if the graph has no
 * details for the artist (or failed to load).
 */
function useArtistDetails(node: GraphNode): ArtistDetails | null | "loading" {
  const read = () => (isMusicBrainzArtist(node) && isDbLoaded() ? getArtistDetails(node.id) : null);
  const [details, setDetails] = useState<ArtistDetails | null | "loading">(() =>
    !isMusicBrainzArtist(node) ? null : isDbLoaded() ? read() : "loading");
  useEffect(() => {
    if (!isMusicBrainzArtist(node)) { setDetails(null); return; }
    if (isDbLoaded()) { setDetails(read()); return; }
    let cancelled = false;
    setDetails("loading");
    getDb().then(() => { if (!cancelled) setDetails(read()); }).catch(() => { if (!cancelled) setDetails(null); });
    return () => { cancelled = true; };
  }, [node.id, node.type]); // eslint-disable-line react-hooks/exhaustive-deps
  return details;
}

export function InfoPanel({ node, onClose }: Props) {
  const details = useArtistDetails(node);
  const loaded = details !== "loading" ? details : null;
  // A node made before details existed may carry its own disambiguation.
  const disambiguation = loaded?.disambiguation ?? (node.type === "artist" ? node.disambiguation : undefined);

  return (
    <aside className="info-panel" style={styles.panel} aria-label="Node details">
      <div style={styles.header}>
        <span style={{ ...styles.badge, background: NODE_COLORS[node.type] }}>
          {TYPE_LABELS[node.type] ?? node.type}
        </span>
        <button onClick={onClose} className="info-close" style={styles.closeBtn} aria-label="Close panel">
          ×
        </button>
      </div>
      <h2 style={styles.name}>{node.name}</h2>
      {disambiguation && <p style={styles.disambiguation}>{disambiguation}</p>}

      {isMusicBrainzArtist(node) && (
        <>
          {details === "loading" ? (
            <p style={styles.muted}>Loading details…</p>
          ) : loaded && loaded.genres.length > 0 ? (
            <ul className="genre-chips" style={styles.genres} aria-label="Genres">
              {loaded.genres.map((g) => <li key={g} style={styles.genre}>{g}</li>)}
            </ul>
          ) : null}
          <a
            className="info-link"
            href={`https://musicbrainz.org/artist/${encodeURIComponent(node.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.link}
          >
            View on MusicBrainz ↗
          </a>
        </>
      )}

      {node.type === "artist" && node.country && (
        <p style={styles.meta}>Country: {node.country}</p>
      )}
      {node.type === "venue" && (
        <>
          {node.city && <p style={styles.meta}>City: {node.city}</p>}
          {node.country && <p style={styles.meta}>Country: {node.country}</p>}
          {node.metadata?.playCount && (
            <p style={styles.meta}>Shows played here: {node.metadata.playCount as number}</p>
          )}
        </>
      )}
      {node.type === "city" && node.country && (
        <p style={styles.meta}>Country: {node.country}</p>
      )}
      {node.metadata && Object.keys(node.metadata).length > 0 && (
        <details style={{ marginTop: "0.75rem" }}>
          <summary style={{ cursor: "pointer", color: "#888" }}>Raw metadata</summary>
          <pre style={styles.pre}>{JSON.stringify(node.metadata, null, 2)}</pre>
        </details>
      )}
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: "280px",
    maxWidth: "100%",
    padding: "1rem",
    background: "#1a1a1a",
    borderLeft: "1px solid #2a2a2a",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.5rem",
  },
  badge: {
    padding: "2px 8px",
    borderRadius: "3px",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#000",
    textTransform: "uppercase",
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#888",
    fontSize: "1.5rem",
    cursor: "pointer",
    lineHeight: 1,
  },
  name: {
    fontSize: "1.2rem",
    fontWeight: 600,
    marginBottom: "0.25rem",
    overflowWrap: "anywhere",
  },
  disambiguation: {
    color: "#bbb",
    fontSize: "0.9rem",
    marginBottom: "0.6rem",
  },
  genres: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.35rem",
    listStyle: "none",
    padding: 0,
    margin: "0 0 0.75rem",
  },
  genre: {
    padding: "0.15rem 0.55rem",
    borderRadius: "10px",
    border: "1px solid #3a3a3a",
    background: "#242424",
    color: "#ddd",
    fontSize: "0.78rem",
  },
  link: {
    display: "inline-flex",
    alignItems: "center",
    color: "#48dbfb",
    fontSize: "0.85rem",
    textDecoration: "none",
  },
  muted: {
    color: "#777",
    fontSize: "0.8rem",
    marginBottom: "0.6rem",
  },
  meta: {
    color: "#aaa",
    fontSize: "0.85rem",
    marginBottom: "0.25rem",
  },
  pre: {
    fontSize: "0.7rem",
    color: "#888",
    background: "#0f0f0f",
    padding: "0.5rem",
    borderRadius: "4px",
    overflow: "auto",
    marginTop: "0.5rem",
  },
};
