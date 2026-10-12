/**
 * Spotify "top artists" import, browser-only.
 *
 * Uses the Authorization Code flow with PKCE, so no client secret is needed and
 * everything runs client-side. Sign-in is a full-page redirect to Spotify; it
 * returns to the app root (`?code=...`), where handleSpotifyRedirect() (called
 * from main.tsx before the router mounts) restores the page the user came from
 * and exchanges the code for a token in the background.
 *
 * The client ID comes from __SPOTIFY_CLIENT_ID__ (vite.config.ts). When it's
 * empty, isSpotifyConfigured() is false and the import button stays hidden.
 */

const CLIENT_ID = __SPOTIFY_CLIENT_ID__;
const SCOPES = "user-top-read";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const TOP_ARTISTS_URL = "https://api.spotify.com/v1/me/top/artists";

const TOKEN_KEY = "msm_spotify_token";
const PENDING_KEY = "msm_spotify_pending";
const ERROR_KEY = "msm_spotify_error";

export type TimeRange = "short_term" | "medium_term" | "long_term";

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // ms epoch
}

/** Saved across the sign-in redirect (sessionStorage). */
interface PendingLogin {
  state: string;
  verifier: string;
  returnHash: string; // HashRouter route to restore, e.g. "#/discover"
  artists: string[]; // the page's list before redirecting, restored afterwards
  importReady?: boolean; // set once the token exchange succeeded
}

export function isSpotifyConfigured(): boolean {
  return CLIENT_ID !== "";
}

/** Must exactly match a Redirect URI registered in the Spotify app settings. */
export function getRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

// --- storage helpers (storage can throw in private mode; treat as empty) ---

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// --- PKCE ---

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// --- sign-in ---

/**
 * Redirect to Spotify to sign in. `currentArtists` is the page's list so far;
 * it's restored (with the imported artists added) after the redirect.
 */
export async function startSpotifyLogin(currentArtists: string[]): Promise<void> {
  const verifier = randomString(64);
  const state = randomString(16);
  const pending: PendingLogin = {
    state,
    verifier,
    returnHash: window.location.hash || "#/",
    artists: currentArtists,
  };
  writeJson(sessionStorage, PENDING_KEY, pending);
  remove(sessionStorage, ERROR_KEY);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: await codeChallenge(verifier),
  });
  window.location.assign(`${AUTHORIZE_URL}?${params}`);
}

let redirectDone: Promise<void> = Promise.resolve();

/**
 * Call once at startup, before the router mounts. If the URL is a Spotify
 * sign-in callback, restores the original route right away and exchanges the
 * code in the background (awaitable via waitForSpotifyRedirect()).
 */
export function handleSpotifyRedirect(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code") && !params.has("error")) return;

  const pending = readJson<PendingLogin>(sessionStorage, PENDING_KEY);
  // Drop ?code=... from the address bar and return to the page the user was on.
  window.history.replaceState(null, "", `${window.location.pathname}${pending?.returnHash ?? window.location.hash}`);

  const fail = (message: string) => {
    remove(sessionStorage, PENDING_KEY);
    writeJson(sessionStorage, ERROR_KEY, message);
  };

  if (!pending || params.get("state") !== pending.state) {
    fail("Spotify sign-in didn't complete. Try again.");
    return;
  }
  if (params.get("error")) {
    fail(params.get("error") === "access_denied" ? "Spotify access was declined." : "Spotify sign-in failed. Try again.");
    return;
  }

  redirectDone = (async () => {
    try {
      const token = await requestToken({
        grant_type: "authorization_code",
        code: params.get("code")!,
        redirect_uri: getRedirectUri(),
        code_verifier: pending.verifier,
      });
      saveToken(token);
      writeJson(sessionStorage, PENDING_KEY, { ...pending, importReady: true });
    } catch {
      fail("Couldn't finish Spotify sign-in. Try again.");
    }
  })();
}

export function waitForSpotifyRedirect(): Promise<void> {
  return redirectDone;
}

/**
 * After a sign-in redirect: the list the page had before redirecting, if an
 * import should now run. Returns null otherwise. One-shot.
 */
export function takePendingImport(): { artists: string[] } | null {
  const pending = readJson<PendingLogin>(sessionStorage, PENDING_KEY);
  if (!pending?.importReady) return null;
  remove(sessionStorage, PENDING_KEY);
  return { artists: pending.artists };
}

/** Error from the last sign-in redirect, if any. One-shot. */
export function takeSpotifyError(): string | null {
  const message = readJson<string>(sessionStorage, ERROR_KEY);
  remove(sessionStorage, ERROR_KEY);
  return message;
}

// --- tokens ---

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function requestToken(body: Record<string, string>): Promise<StoredToken> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  if (!response.ok) throw new Error(`Spotify token request failed (${response.status})`);
  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? body.refresh_token,
    // Refresh a minute early to avoid using a token as it expires.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

function saveToken(token: StoredToken): void {
  writeJson(localStorage, TOKEN_KEY, token);
}

export function signOutOfSpotify(): void {
  remove(localStorage, TOKEN_KEY);
}

/** A usable access token (refreshing if needed), or null if sign-in is required. */
async function getAccessToken(): Promise<string | null> {
  const token = readJson<StoredToken>(localStorage, TOKEN_KEY);
  if (!token) return null;
  if (Date.now() < token.expiresAt) return token.accessToken;
  if (!token.refreshToken) return null;
  try {
    const refreshed = await requestToken({ grant_type: "refresh_token", refresh_token: token.refreshToken });
    saveToken(refreshed);
    return refreshed.accessToken;
  } catch {
    signOutOfSpotify();
    return null;
  }
}

export class SpotifySignInRequired extends Error {
  constructor() {
    super("Spotify sign-in required");
  }
}

/**
 * The signed-in user's top artist names, most-listened first.
 * Throws SpotifySignInRequired when there's no valid session.
 */
export async function getTopArtists(limit = 10, timeRange: TimeRange = "medium_term"): Promise<string[]> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new SpotifySignInRequired();

  const params = new URLSearchParams({ limit: String(limit), time_range: timeRange });
  const response = await fetch(`${TOP_ARTISTS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) {
    signOutOfSpotify();
    throw new SpotifySignInRequired();
  }
  if (!response.ok) throw new Error(`Spotify request failed (${response.status})`);
  const data = (await response.json()) as { items: Array<{ name: string }> };
  return data.items.map((artist) => artist.name);
}
