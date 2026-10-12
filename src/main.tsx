import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { handleSpotifyRedirect } from "./api/spotify";
import "./index.css";

// Must run before the router reads the URL (restores the route after Spotify sign-in).
handleSpotifyRedirect();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
