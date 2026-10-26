import { useEffect, useState } from "react";
import { computeSimilarity, HOP_DAMPING, REL_WEIGHTS, type PairScore, type PathStep, type SimilarityResult } from "./similarity";
import { buildTieredGraphAccess } from "./tieredGraphAccess";
import { ArtistAutocomplete } from "../components/ArtistAutocomplete";
import { relationSentence } from "../graph/relationships";
import { addPicked, chipLabel, fromSuggestion, inputArtist, pickedKey, type PickedArtist } from "./pickedArtists";

function scoreColor(score: number): string {
  if (score >= 70) return "#55efc4";
  if (score >= 40) return "#feca57";
  if (score >= 15) return "#ff9f43";
  return "#636e72";
}

function scoreLabel(score: number): string {
  if (score >= 70) return "Strong match — same musical world";
  if (score >= 40) return "Related — shares members or close connections";
  if (score >= 15) return "Loosely connected";
  return "Little to no connection found";
}

export function SimilarityPage() {
  const [artistInput, setArtistInput] = useState("");
  const [artists, setArtists] = useState<PickedArtist[]>([]);
  const [target, setTarget] = useState("");
  // The artist picked from the compare dropdown, while its name is still in the input.
  const [targetPick, setTargetPick] = useState<PickedArtist | null>(null);
  const [result, setResult] = useState<SimilarityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPair, setOpenPair] = useState<PairScore | null>(null);

  // Escape closes the connection panel.
  useEffect(() => {
    if (!openPair) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPair(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPair]);

  const addArtist = (artist: PickedArtist) => {
    if (!artist.name.trim()) return;
    setArtists(addPicked(artists, artist));
    setArtistInput("");
  };

  const handleAddArtist = () => addArtist({ name: artistInput });

  const handleRemoveArtist = (artist: PickedArtist) => {
    setArtists(artists.filter((a) => pickedKey(a) !== pickedKey(artist)));
  };

  const handleCompare = async () => {
    if (!target.trim() || artists.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setOpenPair(null);

    try {
      const tiered = await buildTieredGraphAccess();
      // Resolve any artists missing from the core graph via Tier 2/3 first.
      const targetArtist = inputArtist(target, targetPick);
      await tiered.prepareArtists([targetArtist, ...artists]);
      const res = computeSimilarity(tiered.build(), targetArtist, artists);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div className="page-container" style={styles.container}>
        <div style={styles.header}>
          <h1 className="page-title" style={styles.title}>Similarity Score</h1>
          <p style={styles.subtitle}>
            See how closely an artist fits a group of artists you like, based on
            shared members and connections in the music graph.
          </p>
        </div>

        <div style={styles.form}>
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

          <div style={styles.field}>
            <label style={styles.label}>Artist to compare</label>
            <ArtistAutocomplete
              value={target}
              onChange={setTarget}
              onSelect={(a) => {
                setTarget(a.name);
                setTargetPick(fromSuggestion(a));
              }}
              onEnter={handleCompare}
              placeholder="e.g. Fuzz"
              inputStyle={styles.input}
              ariaLabel="Artist to compare"
            />
          </div>

          <button
            onClick={handleCompare}
            disabled={loading || !target.trim() || artists.length === 0}
            style={styles.searchBtn}
          >
            {loading ? "Scoring…" : "Compute Similarity"}
          </button>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {result && !result.targetFound && (
          <p style={styles.noResults}>
            "{result.targetName}" wasn't found in the graph. Try a different spelling
            or a more well-known project name.
          </p>
        )}

        {result && result.targetFound && (
          <div style={styles.results}>
            <div style={styles.scoreCard}>
              <div style={{ ...styles.scoreNumber, color: scoreColor(result.overallScore) }}>
                {result.overallScore}
                <span style={styles.scoreOutOf}>/100</span>
              </div>
              <div style={styles.scoreMeta}>
                <div style={styles.scoreTarget}>{result.targetName}</div>
                <div style={styles.scoreLabel}>{scoreLabel(result.overallScore)}</div>
              </div>
            </div>

            <h2 style={styles.resultsTitle}>Breakdown</h2>
            {result.pairs.map((p, i) => {
              const card = (
                <>
                  <div style={styles.pairHeader}>
                    <span style={styles.pairName}>{p.name}</span>
                    {p.found ? (
                      <span style={{ ...styles.pairScore, color: scoreColor(p.score) }}>
                        {p.score}
                      </span>
                    ) : (
                      <span style={styles.pairMissing}>not found</span>
                    )}
                  </div>
                  {p.found && (
                    <div style={styles.pairDetail}>
                      <div style={styles.pairDistance}>
                        {p.distance === null
                          ? "No path found"
                          : p.distance === 0
                            ? "Same artist"
                            : `${p.distance} hop${p.distance === 1 ? "" : "s"} away`}
                      </div>
                    </div>
                  )}
                </>
              );
              return p.found ? (
                <button
                  key={`${p.name}-${i}`}
                  type="button"
                  className="pair-card"
                  style={{
                    ...styles.pairCard,
                    ...styles.pairButton,
                    ...(openPair === p ? styles.pairSelected : {}),
                  }}
                  onClick={() => setOpenPair(p)}
                  aria-expanded={openPair === p}
                  aria-controls="connection-panel"
                >
                  {card}
                </button>
              ) : (
                <div key={`${p.name}-${i}`} style={styles.pairCard}>{card}</div>
              );
            })}
          </div>
        )}

      </div>
      {result && openPair && (
        <ConnectionPanel pair={openPair} result={result} onClose={() => setOpenPair(null)} />
      )}
    </div>
  );
}

/** "1.00 × 0.45 × 0.45 × 0.9² = 0.16 → 16": how the strongest path's weights make the score. */
function scoreFormula(pair: PairScore): string {
  const path = pair.path;
  if (path == null) return "0";
  if (path.length === 0) return "Same artist: 100.";
  const extra = path.length - 1;
  const damping = extra === 0 ? "" : ` × ${HOP_DAMPING}${extra === 1 ? "" : superscript(extra)}`;
  const weights = path.map((s) => s.weight.toFixed(2)).join(" × ");
  return `${weights}${damping} = ${(pair.strength ?? 0).toFixed(2)} → ${pair.score}`;
}

/**
 * Why a hop counts for what it does: how often it happened ("12 songs: 0.80 → 0.97"),
 * and hub damping ("Damped from 0.97: Taylor Swift has 133 links of this kind").
 */
function stepNotes(step: PathStep): string[] {
  const notes: string[] = [];
  const base = step.baseWeight ?? step.weight;
  if (step.count !== undefined) {
    const unit = step.relType === "opened_for" ? "show" : "song";
    const times = `${step.count} ${unit}${step.count === 1 ? "" : "s"}`;
    const plain = REL_WEIGHTS[step.relType];
    notes.push(plain !== undefined && base > plain ? `${times}: ${plain.toFixed(2)} → ${base.toFixed(2)}` : times);
  }
  if (step.hubs) {
    const who = step.hubs.map((h) => `${h.node.name} has ${h.count}`).join(", ");
    notes.push(`Damped from ${base.toFixed(2)}: ${who} links of this kind`);
  }
  return notes;
}

function superscript(n: number): string {
  return String(n).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]!);
}

/**
 * How one liked artist relates to the compared artist. Uses Explore's node
 * panel (.info-panel): a sidebar on desktop, a bottom sheet on phones.
 */
function ConnectionPanel({ pair, result, onClose }: { pair: PairScore; result: SimilarityResult; onClose: () => void }) {
  const path = pair.path;
  return (
    <aside id="connection-panel" className="info-panel" style={styles.panel} aria-label="How they connect">
      <div style={styles.panelHeader}>
        <span style={{ ...styles.panelBadge, background: scoreColor(pair.score) }}>{pair.score}/100</span>
        <button onClick={onClose} className="info-close" style={styles.panelClose} aria-label="Close panel">
          ×
        </button>
      </div>
      <h2 style={styles.panelTitle}>{pair.name} → {result.targetName}</h2>
      <section style={styles.sheetSection}>
        {path == null ? (
          <p style={styles.sheetMuted}>No path within 6 hops strong enough to score 5 or more.</p>
        ) : path.length === 0 ? (
          <p style={styles.sheetMuted}>Same artist.</p>
        ) : (
          <ol style={styles.pathList}>
            {path.map((step, i) => (
              <li key={i} style={styles.pathStep}>
                <span style={styles.weightRow}>
                  <span>{relationSentence(step.relType, step.from.name, step.to.name, step.fromIsSource)}</span>
                  <span style={styles.weightValue}>{step.weight.toFixed(2)}</span>
                </span>
                {stepNotes(step).map((note) => (
                  <span key={note} style={styles.hubNote}>{note}</span>
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section style={styles.sheetSection}>
        <h3 style={styles.sheetHeading}>Score</h3>
        <p style={styles.sheetMuted}>{scoreFormula(pair)}</p>
      </section>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { flex: 1, display: "flex", overflow: "hidden", position: "relative" },
  container: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "1.5rem", overflowY: "auto", gap: "1.25rem" },
  header: { textAlign: "center", maxWidth: "480px" },
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
  noResults: { color: "#888", fontSize: "0.9rem", maxWidth: "450px", textAlign: "center" },
  results: { width: "100%", maxWidth: "450px" },
  scoreCard: { display: "flex", alignItems: "center", gap: "1rem", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "1rem 1.25rem", marginBottom: "1rem" },
  scoreNumber: { fontSize: "2.6rem", fontWeight: 800, lineHeight: 1 },
  scoreOutOf: { fontSize: "1rem", fontWeight: 600, color: "#636e72", marginLeft: "0.15rem" },
  scoreMeta: { display: "flex", flexDirection: "column", gap: "0.2rem" },
  scoreTarget: { fontSize: "1.1rem", fontWeight: 700, color: "#e0e0e0" },
  scoreLabel: { fontSize: "0.8rem", color: "#888" },
  resultsTitle: { fontSize: "1.1rem", fontWeight: 600, color: "#e0e0e0", marginBottom: "0.75rem" },
  pairCard: { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "0.75rem", marginBottom: "0.5rem" },
  pairSelected: { border: "1px solid #48dbfb" },
  pairButton: { display: "block", width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", minHeight: "44px" },
  // Same look as Explore's InfoPanel.
  panel: { width: "280px", maxWidth: "100%", padding: "1rem", background: "#1a1a1a", borderLeft: "1px solid #2a2a2a", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem", flexShrink: 0 },
  panelHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "-0.5rem" },
  panelBadge: { padding: "2px 8px", borderRadius: "3px", fontSize: "0.75rem", fontWeight: 600, color: "#000" },
  panelClose: { background: "none", border: "none", color: "#888", fontSize: "1.5rem", cursor: "pointer", lineHeight: 1 },
  panelTitle: { fontSize: "1.2rem", fontWeight: 600, overflowWrap: "anywhere", margin: 0 },
  sheetSection: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  sheetHeading: { fontSize: "0.75rem", fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.03em", margin: 0 },
  sheetMuted: { fontSize: "0.8rem", color: "#888", margin: 0 },
  pathList: { margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem", color: "#e0e0e0" },
  pathStep: { overflowWrap: "anywhere" },
  hubNote: { display: "block", fontSize: "0.72rem", color: "#888", marginTop: "0.1rem" },
  weightRow: { display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.8rem", color: "#e0e0e0" },
  weightValue: { color: "#48dbfb", fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  pairHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" },
  pairName: { fontWeight: 600, color: "#e0e0e0", fontSize: "0.95rem" },
  pairScore: { fontSize: "1.1rem", fontWeight: 700 },
  pairMissing: { fontSize: "0.75rem", color: "#636e72", fontStyle: "italic" },
  pairDetail: { fontSize: "0.8rem", color: "#888", display: "flex", flexDirection: "column", gap: "0.35rem" },
  pairDistance: { color: "#888" },
};
