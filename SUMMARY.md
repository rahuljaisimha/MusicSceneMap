# MusicSceneMap — Project Summary

## What this is

A React app that builds a music scene knowledge graph in the browser using a precomputed SQLite database (from MusicBrainz data dumps). Includes a "Six Degrees of Music" game. Deployable as a static site on GitHub Pages.

## Tech stack

- Vite + React 18 + TypeScript
- react-router-dom (HashRouter for GitHub Pages compatibility)
- react-force-graph-2d for graph visualization
- sql.js (SQLite compiled to WASM) for querying the graph in-browser
- In-memory SceneGraph with localStorage persistence (Explore view)
- Python script for processing MusicBrainz data dumps into SQLite

## Architecture

```
Data pipeline (offline, run manually):
    MusicBrainz full dump (~4GB)
        → Python script extracts artists, relationships, recording credits
        → BFS from ~145 seed artists (6 hops)
        → SQLite database: nodes (persons, groups, albums) + edges
        → Output: public/graph.db (~50-160MB)

Explore mode:
    User searches artist
        → sql.js queries SQLite for node + neighbors
        → Filters: only person/group nodes shown (albums hidden)
        → Relationships shown: member_of, support_musician
        → In-memory SceneGraph renders as force-directed graph

Game mode (Six Degrees):
    On load → fetch graph.db, load into sql.js
        → Pick two random artists of same type from seed list
        → BFS shortest path (traverses through albums for richer connections)
        → Albums with >25 connections skipped (compilation filter)
        → Show endpoints + par (shortest path length)
        → User guesses intermediates, reveal shows actual shortest path
        → Game persists 24h in localStorage
```

## File structure

```
src/
├── db/
│   └── graphDb.ts        — sql.js wrapper: load DB, BFS, neighbor queries, search. Runtime compilation filter.
├── game/
│   └── artists.ts        — Curated list of ~145 recognizable seed artists (97 persons, 48 groups).
├── graph/
│   ├── types.ts          — Node types, edge types, color maps.
│   ├── SceneGraph.ts     — In-memory graph with dedup/merge, persistence, expanded tracking.
│   └── expand.ts         — (Legacy) MusicBrainz API expansion. Unused now that Explore uses SQLite.
├── pages/
│   ├── ExplorePage.tsx   — Graph exploration via SQLite. Only shows person/group nodes.
│   ├── PlayPage.tsx      — Six Degrees game: BFS pathfinding, suggestions, par scoring, reveal.
│   └── AboutPage.tsx     — Project info, data source credits, GitHub link.
├── components/
│   ├── Layout.tsx        — Shared nav bar with Explore/Play/About links.
│   ├── SearchBar.tsx     — Search input, expand, reset, settings. Responsive layout.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas (solid=expanded, outline=unexpanded).
│   ├── InfoPanel.tsx     — Side panel (desktop) / bottom sheet (mobile) for node details.
│   ├── Settings.tsx      — API key, Setlist.fm toggle, debug toggle, clear all data.
│   └── DebugConsole.tsx  — Collapsible log console.
├── api/
│   ├── musicbrainz.ts    — (Legacy) Live MusicBrainz API client.
│   ├── setlistfm.ts      — (Legacy) Live Setlist.fm API client.
│   └── cache.ts          — (Legacy) localStorage request cache.
├── debug/
│   └── DebugLog.ts       — Singleton log store.
├── App.tsx               — Router (HashRouter, 3 routes).
├── main.tsx              — Entry point.
├── vite-env.d.ts         — Vite type declarations.
├── sql.js.d.ts           — sql.js type declarations.
└── index.css             — Dark theme, responsive media queries, highlight animation.

scripts/
├── process_mb_dump.py    — Downloads MusicBrainz dump, builds SQLite graph.
└── README.md             — Script documentation.

public/
├── graph.db              — (generated, gitignored) SQLite graph database.
└── sql-wasm.wasm         — sql.js WASM binary.

.github/workflows/
└── deploy.yml            — GitHub Actions: build and deploy to GitHub Pages.
```

## SQLite schema

```sql
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,    -- MusicBrainz GID
    name TEXT NOT NULL,
    type TEXT NOT NULL      -- "person", "group", "album"
);

CREATE TABLE edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    rel_type TEXT NOT NULL  -- "member_of", "support_musician", "producer", "vocal",
                           -- "instrument", "mix", "engineer", "recording", "album_by"
);

-- Indexes on edges(source), edges(target), edges(rel_type), nodes(name), nodes(type)
```

## Key design decisions

- **SQLite in browser**: Precomputed graph loaded via sql.js WASM. ~50MB one-time download, instant queries after.
- **BFS pathfinding**: Shortest path between any two artists in <50ms on 200K+ nodes.
- **Compilation filter (runtime)**: Album nodes with >25 connections are skipped during BFS — prevents false shortcuts through tribute albums and compilations.
- **Explore only shows artists**: Album nodes filtered out of neighbor expansion. Only member_of and support_musician relationships visible.
- **Game traverses albums**: BFS walks through album nodes to find collaborator connections (person → album → person). Richer paths.
- **Seed artists**: ~145 recognizable names. BFS at 6 hops from seeds builds the graph. Game picks start/end from this list (same type).
- **Par scoring**: Par = shortest path length. Game re-rolls if distance < 3 hops.
- **Vite base**: Production uses `/MusicSceneMap/` for GitHub Pages; dev uses `/` for convenience.
- **No backend**: Everything runs client-side. Graph data is a static file.
- **Game persistence**: 24h in localStorage. New Game clears and regenerates.
- **Responsive**: Mobile-friendly layout, bottom sheet InfoPanel, no keyboard popup on node click.

## Running

```bash
npm install
npm run dev
# Access at http://localhost:5173/
```

## Generating the graph database

```bash
brew install zstd
python3 scripts/process_mb_dump.py
# Downloads ~4GB MusicBrainz dump (cached after first run)
# Outputs public/graph.db (~50-160MB depending on seed list and hops)
```

## Deploying

Push to `main`. GitHub Actions builds and deploys to Pages automatically.
Requires: repo Settings → Pages → Source → GitHub Actions.
Note: `graph.db` is gitignored — must be hosted separately or generated in CI.

## What's missing / next steps

- **Expand seed list to ~300 artists**: More coverage across genres/eras, reduce MAX_HOPS to 4 for tighter graphs.
- **Genre/decade graph splits**: Separate smaller files per genre for faster downloads and focused game experiences.
- **Show album collaborators in Explore**: Collapse person→album→person into direct edges so producers/guests are visible without showing album nodes.
- **Album→artist edges**: Add `album_by` edges in the script (via `artist_credit_name` table) so contributors can be found from the band directly.
- **Filter compilations in script**: Remove compilations at build time (release_group.type=11) in addition to runtime filter.
- **FTS5 search**: Full-text search for fuzzy name matching ("The Arctic Monkeys" → "Arctic Monkeys"). Include artist aliases.
- **Daily puzzle mode**: Same game for all users each day (date-seeded), shareable results, leaderboard.
- **Expand node on click**: Direct expansion from graph without search bar.
- **Legend on graph canvas**: Color key for node/edge types.
- **Scene detection**: Graph algorithms to identify communities/scenes automatically.
- **Travel mode**: Input a city, show relevant venues/scenes filtered by taste (requires Setlist.fm or venue data).
- **Setlist.fm integration**: Venue data, touring-together inference via shared date+venue.
- **PostgreSQL backend (future)**: For complex graph queries, venue recommendations, multi-user leaderboards.
