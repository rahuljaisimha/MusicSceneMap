import { useEffect, useRef, useState } from "react";
import {
  getTopArtists,
  isSpotifyConfigured,
  SpotifySignInRequired,
  startSpotifyLogin,
  takePendingImport,
  takeSpotifyError,
  waitForSpotifyRedirect,
} from "../api/spotify";

const TOP_ARTIST_COUNT = 10;

interface Props {
  /** The page's current artist list (restored after the sign-in redirect). */
  artists: string[];
  /** Replace the page's list. Receives the existing list plus new Spotify artists. */
  onChange: (artists: string[]) => void;
}

/** Adds names not already in the list (case-insensitive), keeping order. */
function mergeArtists(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((a) => a.toLowerCase()));
  const added = incoming.filter((a) => {
    const key = a.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...existing, ...added];
}

/**
 * "Add my Spotify top artists" button for pages that take a list of artists.
 * Hidden when no Spotify client ID is configured.
 */
export function SpotifyImportButton({ artists, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // Latest list for the async import below (avoids a stale closure).
  const artistsRef = useRef(artists);
  artistsRef.current = artists;

  const importTopArtists = async (base: string[]) => {
    setBusy(true);
    setMessage(null);
    try {
      const top = await getTopArtists(TOP_ARTIST_COUNT);
      const merged = mergeArtists(base, top);
      onChange(merged);
      const added = merged.length - base.length;
      setMessage({
        text: added > 0 ? `Added ${added} artist${added === 1 ? "" : "s"} from Spotify` : "Your Spotify top artists are already in the list",
        error: false,
      });
    } catch (e) {
      if (e instanceof SpotifySignInRequired) {
        await startSpotifyLogin(base); // redirects away
        return;
      }
      setMessage({ text: "Couldn't load your Spotify top artists. Try again.", error: true });
    } finally {
      setBusy(false);
    }
  };

  // Finish an import that started before the sign-in redirect.
  useEffect(() => {
    if (!isSpotifyConfigured()) return;
    let cancelled = false;
    (async () => {
      await waitForSpotifyRedirect();
      if (cancelled) return;
      const error = takeSpotifyError();
      if (error) {
        setMessage({ text: error, error: true });
        return;
      }
      const pending = takePendingImport();
      if (pending) importTopArtists(mergeArtists(pending.artists, artistsRef.current));
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isSpotifyConfigured()) return null;

  return (
    <div style={styles.wrapper}>
      <button
        type="button"
        className="spotify-import"
        onClick={() => importTopArtists(artistsRef.current)}
        disabled={busy}
        style={styles.button}
      >
        {busy ? "Loading from Spotify…" : "Add my Spotify top artists"}
      </button>
      {message && (
        <span role="status" style={message.error ? styles.error : styles.status}>
          {message.text}
        </span>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" },
  button: {
    padding: "0.4rem 0.8rem",
    borderRadius: "999px",
    border: "1px solid #1db954",
    background: "transparent",
    color: "#1db954",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.8rem",
  },
  status: { color: "#888", fontSize: "0.8rem" },
  error: { color: "#ff6b6b", fontSize: "0.8rem" },
};
