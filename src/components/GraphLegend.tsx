import { EDGE_COLORS, NODE_COLORS, type EdgeType } from "../graph/types";
import { EXPLORE_RELATIONSHIPS } from "../graph/relationships";

interface Props {
  visible: EdgeType[];
  onToggle: (type: EdgeType) => void;
}

// Collapsed by default on phones, where it would cover the graph.
const startOpen = typeof window === "undefined" || !window.matchMedia("(max-width: 640px)").matches;

/**
 * Explore's legend: what each node colour and edge colour means, and which way
 * the arrows point. Each relationship type has a checkbox that shows or hides
 * those edges (and the artists only they connect).
 */
export function GraphLegend({ visible, onToggle }: Props) {
  return (
    <details className="graph-legend" style={styles.panel} open={startOpen}>
      <summary style={styles.summary}>Legend</summary>
      <div style={styles.section}>
        {EXPLORE_RELATIONSHIPS.map((r) => (
          <label key={r.type} className="graph-legend-row" style={styles.row} title={r.direction}>
            <input type="checkbox" checked={visible.includes(r.type)} onChange={() => onToggle(r.type)} />
            <ArrowSwatch color={EDGE_COLORS[r.type]} />
            <span style={styles.text}>
              <span>{r.label}</span>
              <span style={styles.direction}>{r.direction}</span>
            </span>
          </label>
        ))}
      </div>
      <div style={{ ...styles.section, ...styles.nodes }}>
        <span style={styles.nodeRow}><Dot color={NODE_COLORS.artist} filled /> Group</span>
        <span style={styles.nodeRow}><Dot color={NODE_COLORS.musician} filled /> Person</span>
        <span style={styles.nodeRow}><Dot color="#aaa" filled /> expanded <Dot color="#aaa" /> not yet</span>
      </div>
    </details>
  );
}

function ArrowSwatch({ color }: { color: string }) {
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true" style={{ flex: "none" }}>
      <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth="2" />
      <path d="M20 1 L27 5 L20 9 Z" fill={color} />
    </svg>
  );
}

function Dot({ color, filled = false }: { color: string; filled?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="6" cy="6" r="4.5" fill={filled ? color : "none"} stroke={color} strokeWidth="2" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: "absolute", left: "0.75rem", bottom: "0.75rem", zIndex: 5, maxWidth: "min(320px, calc(100% - 1.5rem))",
    background: "rgba(20, 20, 20, 0.92)", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "0.5rem 0.75rem",
    color: "#ccc", fontSize: "0.8rem",
  },
  summary: { cursor: "pointer", fontWeight: 600, color: "#e0e0e0", userSelect: "none" },
  section: { display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.5rem" },
  row: { display: "flex", alignItems: "center", gap: "0.45rem", cursor: "pointer" },
  text: { display: "flex", flexDirection: "column", lineHeight: 1.25 },
  direction: { color: "#777", fontSize: "0.72rem" },
  nodes: { flexDirection: "row", flexWrap: "wrap", gap: "0.3rem 0.9rem", borderTop: "1px solid #2a2a2a", paddingTop: "0.5rem" },
  nodeRow: { display: "inline-flex", alignItems: "center", gap: "0.3rem" },
};
