# MusicSceneMap — Project Summary

## What this is

A proof-of-concept React app that builds a music scene knowledge graph directly in the browser by querying MusicBrainz and Setlist.fm APIs. No backend. High latency is acceptable.

## Tech stack

- Vite + React 18 + TypeScript
- react-force-graph-2d for graph visualization
- In-memory graph (no database yet)

## Architecture

```
User searches artist
    → MusicBrainz API: get artist, members, bands, labels
    → Setlist.fm API: get venues, cities, related artists (covers/guests)
    → In-memory SceneGraph accumulates nodes + edges
    → Force-directed graph renders in browser
```

## File structure

```
src/
├── api/
│   ├── musicbrainz.ts    — Search, get relations, extract members/bands/labels. 1req/s rate limit.
│   └── setlistfm.ts      — Get setlists, extract venues + related artists. Requires API key in localStorage.
├── graph/
│   ├── types.ts          — Node types: artist, musician, venue, city, scene, label, festival.
│   │                       Edge types: member_of, played_at, located_in, signed_to, collaborated_with, etc.
│   ├── SceneGraph.ts     — In-memory graph with dedup/merge, serializes to force-graph format.
│   └── expand.ts         — Orchestrator: search → fetch → populate graph.
├── components/
│   ├── SearchBar.tsx     — Text input + expand button.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas.
│   ├── InfoPanel.tsx     — Side panel showing clicked node details.
│   └── Settings.tsx      — Gear icon dropdown to enter Setlist.fm API key.
├── App.tsx               — State management, wires components together.
├── main.tsx              — Entry point.
└── index.css             — Dark theme base styles.
```

## Key design decisions

- No backend: browser calls APIs directly (acceptable for single-user POC).
- Setlist.fm API key stored in browser localStorage, entered via UI.
- Graph is additive: each search expands the same graph, revealing connections between artists.
- MusicBrainz rate limit (1 req/sec) enforced client-side.
- Node types have distinct colors; edge types have distinct colors.

## Running

```bash
npm install
npm run dev
```

## What's missing / next steps

- No persistence (graph is lost on refresh)
- No "expand node" interaction (only search bar expands)
- No scene detection / community clustering
- No travel mode
- No backend or database (intentionally deferred)
- Setlist.fm data is limited to first page of results (20 setlists)
