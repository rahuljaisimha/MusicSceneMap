import { useState, useEffect, useCallback } from "react";
import { generateGameChain, type GameChain } from "../game/generateChain";
import { DebugConsole } from "../components/DebugConsole";

const GAME_STORAGE_KEY = "msm_current_game";
const GAME_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredGame {
  chain: GameChain;
  guesses: string[];
  revealed: boolean;
  timestamp: number;
}

function loadGame(): StoredGame | null {
  const raw = localStorage.getItem(GAME_STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredGame;
    if (Date.now() - stored.timestamp > GAME_TTL_MS) {
      localStorage.removeItem(GAME_STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    localStorage.removeItem(GAME_STORAGE_KEY);
    return null;
  }
}

function saveGame(chain: GameChain, guesses: string[], revealed: boolean): void {
  const stored: StoredGame = { chain, guesses, revealed, timestamp: Date.now() };
  try {
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage full — silently fail
  }
}

function clearGame(): void {
  localStorage.removeItem(GAME_STORAGE_KEY);
}

type GameState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "playing"; chain: GameChain; guesses: string[]; revealed: boolean }

export function PlayPage() {
  const [state, setState] = useState<GameState>(() => {
    const saved = loadGame();
    if (saved) {
      return { status: "playing", chain: saved.chain, guesses: saved.guesses, revealed: saved.revealed };
    }
    return { status: "loading" };
  });
  const [input, setInput] = useState("");

  const startNewGame = useCallback(async () => {
    clearGame();
    setState({ status: "loading" });
    const chain = await generateGameChain();
    if (chain) {
      saveGame(chain, [], false);
      setState({ status: "playing", chain, guesses: [], revealed: false });
    } else {
      setState({ status: "error", message: "Could not generate a chain. Try again." });
    }
  }, []);

  // Only generate on first load if there's no saved game
  useEffect(() => {
    if (state.status === "loading") {
      startNewGame();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGuess = () => {
    if (state.status !== "playing" || !input.trim()) return;
    const newGuesses = [...state.guesses, input.trim()];
    setInput("");
    saveGame(state.chain, newGuesses, state.revealed);
    setState({ ...state, guesses: newGuesses });
  };

  const handleReveal = () => {
    if (state.status !== "playing") return;
    saveGame(state.chain, state.guesses, true);
    setState({ ...state, revealed: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleGuess();
  };

  return (
    <div style={styles.page}>
      <DebugConsole />
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Six Degrees of Music</h1>
          <p style={styles.subtitle}>
            Connect these two musicians through bands and collaborators.
          </p>
        </div>

        {state.status === "loading" && (
          <div style={styles.loadingCard}>
            <p style={styles.loadingText}>Generating chain…</p>
            <p style={styles.hint}>This may take a few seconds (rate-limited API calls)</p>
          </div>
        )}

        {state.status === "error" && (
          <div style={styles.card}>
            <p style={styles.errorText}>{state.message}</p>
            <button onClick={startNewGame} style={styles.newGameBtn}>Try Again</button>
          </div>
        )}

        {state.status === "playing" && (
          <>
            <div style={styles.endpointsCard}>
              <div style={styles.endpoint}>
                <span style={styles.endpointLabel}>Start</span>
                <span style={styles.endpointName}>{state.chain.chain[0].name}</span>
              </div>
              <div style={styles.arrow}>→ ? → ? → ? →</div>
              <div style={styles.endpoint}>
                <span style={styles.endpointLabel}>End</span>
                <span style={styles.endpointName}>{state.chain.chain[4].name}</span>
              </div>
            </div>

            {!state.revealed && (
              <div style={styles.inputSection}>
                <p style={styles.inputLabel}>
                  Guess the path (bands and people in between):
                </p>
                <div style={styles.inputRow}>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type an artist or band name"
                    style={styles.input}
                    aria-label="Guess artist or band"
                  />
                  <button onClick={handleGuess} disabled={!input.trim()} style={styles.guessBtn}>
                    Add
                  </button>
                </div>
                {state.guesses.length > 0 && (
                  <div style={styles.guessList}>
                    <p style={styles.guessLabel}>Your guesses:</p>
                    {state.guesses.map((g, i) => (
                      <span key={i} style={styles.guessChip}>{g}</span>
                    ))}
                  </div>
                )}
                <button onClick={handleReveal} style={styles.revealBtn}>
                  Reveal Answer
                </button>
              </div>
            )}

            {state.revealed && (
              <div style={styles.revealSection}>
                <p style={styles.revealLabel}>The path:</p>
                <div style={styles.chainDisplay}>
                  {state.chain.chain.map((link, i) => (
                    <span key={link.id} style={styles.chainItem}>
                      <span style={link.type === "person" ? styles.personChip : styles.bandChip}>
                        {link.name}
                      </span>
                      {i < 4 && <span style={styles.chainArrow}>→</span>}
                    </span>
                  ))}
                </div>
                {state.guesses.length > 0 && (
                  <div style={styles.guessList}>
                    <p style={styles.guessLabel}>Your guesses were:</p>
                    {state.guesses.map((g, i) => {
                      const isCorrect = state.chain.chain.some(
                        (link) => link.name.toLowerCase() === g.toLowerCase()
                      );
                      return (
                        <span
                          key={i}
                          style={{ ...styles.guessChip, ...(isCorrect ? styles.correctChip : styles.wrongChip) }}
                        >
                          {g} {isCorrect ? "✓" : "✗"}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button onClick={startNewGame} style={styles.newGameBtn}>
              New Game
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "1.5rem",
    overflowY: "auto",
    gap: "1rem",
  },
  header: {
    textAlign: "center",
  },
  title: {
    fontSize: "1.6rem",
    fontWeight: 700,
    color: "#e0e0e0",
    marginBottom: "0.25rem",
  },
  subtitle: {
    color: "#888",
    fontSize: "0.9rem",
  },
  loadingCard: {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: "8px",
    padding: "2rem",
    textAlign: "center",
  },
  loadingText: {
    color: "#e0e0e0",
    fontSize: "1rem",
    marginBottom: "0.5rem",
  },
  hint: {
    color: "#666",
    fontSize: "0.8rem",
  },
  card: {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: "8px",
    padding: "1.5rem",
    textAlign: "center",
  },
  errorText: {
    color: "#ff6b6b",
    marginBottom: "1rem",
  },
  endpointsCard: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: "8px",
    padding: "1.25rem 1.5rem",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  endpoint: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.25rem",
  },
  endpointLabel: {
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#888",
  },
  endpointName: {
    fontSize: "1.2rem",
    fontWeight: 700,
    color: "#feca57",
  },
  arrow: {
    color: "#555",
    fontSize: "1rem",
    fontFamily: "monospace",
  },
  inputSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.75rem",
    width: "100%",
    maxWidth: "400px",
  },
  inputLabel: {
    color: "#aaa",
    fontSize: "0.85rem",
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
    width: "100%",
  },
  input: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    borderRadius: "4px",
    border: "1px solid #444",
    background: "#2a2a2a",
    color: "#e0e0e0",
    fontSize: "16px",
  },
  guessBtn: {
    padding: "0.5rem 1rem",
    borderRadius: "4px",
    border: "none",
    background: "#feca57",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
  },
  guessList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
    alignItems: "center",
  },
  guessLabel: {
    color: "#888",
    fontSize: "0.8rem",
    width: "100%",
    marginBottom: "0.25rem",
  },
  guessChip: {
    padding: "0.2rem 0.6rem",
    borderRadius: "12px",
    fontSize: "0.8rem",
    background: "#2a2a2a",
    color: "#e0e0e0",
    border: "1px solid #444",
  },
  correctChip: {
    borderColor: "#55efc4",
    color: "#55efc4",
  },
  wrongChip: {
    borderColor: "#636e72",
    color: "#888",
  },
  revealBtn: {
    padding: "0.5rem 1rem",
    borderRadius: "4px",
    border: "1px solid #444",
    background: "transparent",
    color: "#888",
    cursor: "pointer",
    fontSize: "0.85rem",
    marginTop: "0.5rem",
  },
  revealSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.75rem",
  },
  revealLabel: {
    color: "#55efc4",
    fontWeight: 600,
    fontSize: "0.9rem",
  },
  chainDisplay: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.25rem",
  },
  chainItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
  },
  personChip: {
    padding: "0.3rem 0.7rem",
    borderRadius: "12px",
    fontSize: "0.85rem",
    background: "rgba(254, 202, 87, 0.15)",
    color: "#feca57",
    border: "1px solid #feca57",
  },
  bandChip: {
    padding: "0.3rem 0.7rem",
    borderRadius: "12px",
    fontSize: "0.85rem",
    background: "rgba(255, 107, 107, 0.15)",
    color: "#ff6b6b",
    border: "1px solid #ff6b6b",
  },
  chainArrow: {
    color: "#555",
    margin: "0 0.15rem",
  },
  newGameBtn: {
    padding: "0.6rem 1.25rem",
    borderRadius: "4px",
    border: "none",
    background: "#ff6b6b",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.9rem",
    marginTop: "0.5rem",
  },
};
