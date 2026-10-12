import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Base path precedence:
  //   1. Explicit DEPLOY_BASE env var (manual override, any host).
  //   2. Cloudflare build (CF_PAGES is set automatically by Cloudflare) → "/"
  //      since workers.dev / pages.dev serve at the domain root.
  //   3. GitHub Pages production default → "/MusicSceneMap/".
  //   4. Local dev → "/".
  const base =
    process.env.DEPLOY_BASE ??
    (process.env.CF_PAGES ? "/" : mode === "production" ? "/MusicSceneMap/" : "/");

  // CDN URL for the graph DB. Cloudflare's Worker (static-assets-only) can't
  // hold env vars, so we can't rely on VITE_GRAPH_DB_URL being set there.
  // Instead, default to the R2 URL on Cloudflare builds (CF_PAGES is set during
  // Workers Builds). An explicit VITE_GRAPH_DB_URL env var still overrides.
  const CLOUDFLARE_R2_GRAPH_URL =
    "https://pub-466afa6f120c41149f30d306dc81a9ee.r2.dev/graph.db.gz";
  const graphDbCdnUrl =
    process.env.VITE_GRAPH_DB_URL ?? (process.env.CF_PAGES ? CLOUDFLARE_R2_GRAPH_URL : "");

  return {
    plugins: [react()],
    base,
    define: {
      // Inlined at build; read in src/db/graphDb.ts.
      __GRAPH_DB_CDN_URL__: JSON.stringify(graphDbCdnUrl),
    },
    server: {
      proxy: {
        "/setlistfm-api": {
          target: "https://api.setlist.fm",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/setlistfm-api/, "/rest/1.0"),
        },
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
