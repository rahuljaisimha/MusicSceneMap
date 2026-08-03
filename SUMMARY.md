# MusicSceneMap — Project Summary

## What this is

A proof-of-concept React app that builds a music scene knowledge graph directly in the browser by querying MusicBrainz and Setlist.fm APIs. No backend. High latency is acceptable. Deployable as a static site on GitHub Pages.

## Tech stack

- Vite + React 18 + TypeScript
- react-force-graph-2d for graph visualization
- In-memory graph (no database yet)

## Architecture

```
User searches artist
    → MusicBrainz API: get artist, members, bands, labels
    → Setlist.fm API (optional, off by default): get venues, cities, related artists
    → In-memory SceneGraph accumulates nodes + edges
    → Force-directed graph renders in browser
```

## File structure

```
src/
├── api/
│   ├── musicbrainz.ts    — Search, get relations, extract members/bands/labels. 1req/s rate limit.
│   └── setlistfm.ts      — Get setlists, extract venues + related artists. Requires API key + enabled toggle.
├── graph/
│   ├── types.ts          — Node types: artist, musician, venue, city, scene, label, festival.
│   │                       Edge types: member_of, played_at, located_in, signed_to, collaborated_with, etc.
│   ├── SceneGraph.ts     — In-memory graph with dedup/merge, serializes to force-graph format.
│   └── expand.ts         — Orchestrator: search → fetch → populate graph.
├── components/
│   ├── SearchBar.tsx     — Text input + expand button.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas.
│   ├── InfoPanel.tsx     — Side panel showing clicked node details.
│   ├── Settings.tsx      — Gear icon dropdown: API key, Setlist.fm toggle, debug mode toggle.
│   └── DebugConsole.tsx  — Collapsible log console showing API requests.
├── debug/
│   └── DebugLog.ts       — Singleton log store with subscribe/notify pattern.
├── App.tsx               — State management, wires components together.
├── main.tsx              — Entry point.
├── vite-env.d.ts         — Vite client type declarations.
└── index.css             — Dark theme base styles.

.github/workflows/
└── deploy.yml            — GitHub Actions workflow to build and deploy to GitHub Pages.
```

## Key design decisions

- No backend: browser calls APIs directly (acceptable for single-user POC).
- Setlist.fm is off by default (toggle in settings). Reduces graph complexity until the data is more useful.
- Setlist.fm API key stored in browser localStorage, entered via settings UI.
- CORS workaround for Setlist.fm: Vite proxy in dev, corsproxy.io in production.
- Graph is additive: each search expands the same graph, revealing connections between artists.
- MusicBrainz rate limit (1 req/sec) enforced client-side.
- Node types have distinct colors; edge types have distinct colors.
- Debug mode (toggle in settings) shows a collapsible console logging API requests. Minimized = last line; expanded = last 10 lines with scroll.
- Deployable to GitHub Pages via `base: "/MusicSceneMap/"` in Vite config + GitHub Actions workflow.

## Running

```bash
npm install
npm run dev
```

## Deploying

Push to `main`. GitHub Actions builds and deploys to Pages automatically.
Requires: repo Settings → Pages → Source → GitHub Actions.

## What's missing / next steps

- No persistence (graph is lost on refresh)
- No "expand node" interaction (only search bar expands)
- No scene detection / community clustering
- No travel mode
- No legend on the graph canvas
- No backend or database (intentionally deferred)
- Setlist.fm data is limited to first page of results (20 setlists)
