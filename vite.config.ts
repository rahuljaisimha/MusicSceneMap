import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Is this a Cloudflare build? Workers Builds sets WORKERS_CI=1; Cloudflare
  // Pages sets CF_PAGES. Either way, Cloudflare serves at the domain root.
  const isCloudflareBuild = Boolean(process.env.WORKERS_CI || process.env.CF_PAGES);

  // Base path precedence:
  //   1. Explicit DEPLOY_BASE env var (manual override, any host).
  //   2. Cloudflare build → "/" (workers.dev / pages.dev serve at root).
  //   3. GitHub Pages production default → "/MusicSceneMap/".
  //   4. Local dev → "/".
  const base =
    process.env.DEPLOY_BASE ??
    (isCloudflareBuild ? "/" : mode === "production" ? "/MusicSceneMap/" : "/");

  // CDN URL for the graph DB. Cloudflare's static-assets-only Worker can't hold
  // env vars, so we can't rely on VITE_GRAPH_DB_URL being set there. Instead,
  // default to the R2 URL on Cloudflare builds. An explicit VITE_GRAPH_DB_URL
  // env var still overrides.
  const CLOUDFLARE_R2_GRAPH_URL =
    "https://pub-466afa6f120c41149f30d306dc81a9ee.r2.dev/graph.db.gz";
  const graphDbCdnUrl =
    process.env.VITE_GRAPH_DB_URL ?? (isCloudflareBuild ? CLOUDFLARE_R2_GRAPH_URL : "");

  // Spotify app client ID for the "Add my Spotify top artists" import (PKCE,
  // no secret, so it's safe to ship in the bundle). Paste it here or set
  // VITE_SPOTIFY_CLIENT_ID. Empty = the import button is hidden.
  const SPOTIFY_CLIENT_ID = "17f075a777004b2abe1f90c8ec5dedee";
  const spotifyClientId = process.env.VITE_SPOTIFY_CLIENT_ID ?? SPOTIFY_CLIENT_ID;

  return {
    plugins: [react()],
    base,
    define: {
      // Inlined at build; read in src/db/graphDb.ts.
      __GRAPH_DB_CDN_URL__: JSON.stringify(graphDbCdnUrl),
      // Inlined at build; read in src/api/spotify.ts.
      __SPOTIFY_CLIENT_ID__: JSON.stringify(spotifyClientId),
    },
    server: {
      proxy: {
        "/pollstar-ac": {
          target: "https://autocomplete.pollstar.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/pollstar-ac/, ""),
        },
        "/pollstar-api": {
          target: "https://www.pollstar.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/pollstar-api/, ""),
        },
      },
    },
  };
});
