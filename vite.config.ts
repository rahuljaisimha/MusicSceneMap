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

  return {
    plugins: [react()],
    base,
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
