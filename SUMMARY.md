# MusicSceneMap — Project Summary

## What this is

A proof-of-concept React app that builds a music scene knowledge graph directly in the browser by querying MusicBrainz and Setlist.fm APIs. No backend. High latency is acceptable. Deployable as a static site on GitHub Pages.

## Tech stack

- Vite + React 18 + TypeScript
- react-force-graph-2d for graph visualization
- In-memory graph with localStorage persistence

## Architecture

```
User searches artist
    → Check request cache (localStorage, 48h TTL)
    → If miss: MusicBrainz API: get artist, members, bands, labels
    → If miss + enabled: Setlist.fm API: get venues, cities, related artists
    → In-memory SceneGraph accumulates nodes + edges
    → Graph saved to localStorage
    → Force-directed graph renders in browser
```

## File structure

```
src/
├── api/
│   ├── musicbrainz.ts    — Search, get relations, extract members/bands/labels. 1req/s rate limit.
│   ├── setlistfm.ts      — Get setlists, extract venues + related artists. Requires API key + enabled toggle.
│   └── cache.ts          — localStorage request cache with 48h TTL.
├── graph/
│   ├── types.ts          — Node types: artist, musician, venue, city, scene, label, festival.
│   │                       Edge types: member_of, played_at, located_in, signed_to, collaborated_with, etc.
│   ├── SceneGraph.ts     — In-memory graph with dedup/merge, persistence, expanded tracking.
│   └── expand.ts         — Orchestrator: search → fetch → populate graph. Uses MB type field to distinguish Person vs Group.
├── components/
│   ├── SearchBar.tsx     — Title, search input, expand, reset, settings. Responsive single/two-row layout.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas.
│   ├── InfoPanel.tsx     — Side panel (desktop) / bottom sheet (mobile) showing clicked node details.
│   ├── Settings.tsx      — Gear icon dropdown: API key, Setlist.fm toggle, debug toggle, clear all data.
│   └── DebugConsole.tsx  — Collapsible log console showing API requests.
├── debug/
│   └── DebugLog.ts       — Singleton log store with subscribe/notify pattern.
├── App.tsx               — State management, wires components together.
├── main.tsx              — Entry point.
├── vite-env.d.ts         — Vite client type declarations.
└── index.css             — Dark theme, mobile media queries.

.github/workflows/
└── deploy.yml            — GitHub Actions workflow to build and deploy to GitHub Pages.
```

## Key design decisions

- No backend: browser calls APIs directly (acceptable for single-user POC).
- Setlist.fm is off by default (toggle in settings). Reduces graph complexity until the data is more useful.
- Setlist.fm API key stored in browser localStorage, entered via settings UI.
- CORS workaround for Setlist.fm: Vite proxy in dev, corsproxy.io in production.
- Graph is additive: each search expands the same graph, revealing connections between artists.
- Graph persists to localStorage; restored on page load. Reset button clears it.
- Request caching: API responses cached in localStorage with 48h TTL. Repeat searches are instant.
- MusicBrainz `type` field distinguishes Person (yellow musician node) from Group (red artist node).
- MusicBrainz member deduplication: a member is "current" if any of their membership relationships is not ended (handles "original member" + "member" dual relationships).
- Search prefers exact name match over MusicBrainz relevance ranking.
- Expanded nodes render as solid fill; unexpanded as colored outlines.
- Clicking a node prefills the search bar with a highlight flash.
- MusicBrainz rate limit (1 req/sec) enforced client-side.
- Debug mode (toggle in settings) shows a collapsible console logging API requests.
- Responsive: single-row header on desktop, two-row on mobile. InfoPanel is sidebar on desktop, bottom sheet on mobile.
- Deployable to GitHub Pages via `base: "/MusicSceneMap/"` in Vite config + GitHub Actions workflow.
- Settings includes "Clear all stored data" button (wipes localStorage and reloads).

## Running

```bash
npm install
npm run dev
```

## Deploying

Push to `main`. GitHub Actions builds and deploys to Pages automatically.
Requires: repo Settings → Pages → Source → GitHub Actions.

## What's missing / next steps

- No "expand node" interaction (only search bar expands, though click prefills it)
- No scene detection / community clustering
- No travel mode
- No legend on the graph canvas
- No backend or database (intentionally deferred)
- Setlist.fm data is limited to first page of results (20 setlists)
