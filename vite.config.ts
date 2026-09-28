import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? "/MusicSceneMap/" : "/",
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
}));
