import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { handleSpotifyRedirect } from "./api/spotify";
import { preloadDb } from "./db/graphDb";
import "./index.css";

// Must run before the router reads the URL (restores the route after Spotify sign-in).
handleSpotifyRedirect();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Download the graph database in the background once the first screen is up,
// instead of making pages wait for it (see src/db/graphSource.ts).
if ("requestIdleCallback" in window) {
  window.requestIdleCallback(preloadDb, { timeout: 2000 });
} else {
  setTimeout(preloadDb, 0);
}
