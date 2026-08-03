import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/MusicSceneMap/",
  server: {
    proxy: {
      "/setlistfm-api": {
        target: "https://api.setlist.fm",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/setlistfm-api/, "/rest/1.0"),
      },
    },
  },
});
