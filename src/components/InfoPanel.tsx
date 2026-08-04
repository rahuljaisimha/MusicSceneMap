import type { GraphNode } from "../graph/types";
import { NODE_COLORS } from "../graph/types";

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function InfoPanel({ node, onClose }: Props) {
  const isMobile = window.innerWidth < 640;

  return (
    <aside style={isMobile ? styles.panelMobile : styles.panel} aria-label="Node details">
      <div style={styles.header}>
        <span style={{ ...styles.badge, background: NODE_COLORS[node.type] }}>
          {node.type}
        </span>
        <button onClick={onClose} style={styles.closeBtn} aria-label="Close panel">
          ×
        </button>
      </div>
      <h2 style={styles.name}>{node.name}</h2>
      {node.type === "artist" && node.disambiguation && (
        <p style={styles.meta}>{node.disambiguation}</p>
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
  panelMobile: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: "40vh",
    padding: "1rem",
    background: "#1a1a1a",
    borderTop: "1px solid #2a2a2a",
    overflowY: "auto",
    zIndex: 50,
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
    marginBottom: "0.5rem",
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
