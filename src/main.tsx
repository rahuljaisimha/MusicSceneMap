import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { preloadDb } from "./db/graphDb";
import "./index.css";

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
