# MusicSceneMap — Project Summary

## What this is

A React app that visualizes music scene connections and includes a "Six Degrees of Music" game. Uses a precomputed SQLite database (from MusicBrainz data dumps) queried in the browser via WebAssembly. Deployed as a static site on GitHub Pages.

## Tech stack

- Vite + React 18 + TypeScript
- react-router-dom (HashRouter for GitHub Pages compatibility)
- react-force-graph-2d for graph visualization
- sql.js (SQLite compiled to WASM) for in-browser graph queries
- In-memory SceneGraph with localStorage persistence (Explore view)
- Python script for processing MusicBrainz data dumps into SQLite

## Architecture

```
Data pipeline (offline, run manually):
    MusicBrainz full dump (~4GB)
        → Python script extracts artists, relationships, recording credits
        → BFS from ~145 seed artists (6 hops via member_of/support_musician)
        → Deduplicates memberships (any active = current, not former)
        → SQLite database: nodes (persons, groups, albums) + edges
        → Output: public/graph.db.gz (~61MB, committed to repo)

App loading:
    Browser fetches graph.db.gz
        → Auto-detects gzip (magic number 1f8b) and decompresses if needed
        → sql.js opens the SQLite database in WASM
        → All queries are local, instant (<50ms)

Explore mode:
    User searches artist
        → sql.js queries SQLite for node + neighbors
        → Only person/group nodes shown (albums filtered out)
        → Relationships shown: member_of, former_member_of, support_musician
        → In-memory SceneGraph renders as force-directed graph
        → Graph persists in localStorage across sessions

Game mode (Six Degrees of Music):
    On load → pick two random artists of same type from seed list
        → BFS shortest path (restricted to member_of/former_member_of/support_musician)
        → Albums with >25 connections skipped at runtime (compilation filter)
        → Re-rolls if distance < 3 hops
        → Shows endpoints + par (shortest path length)
        → User navigates by selecting from valid connections list
        → Undo support, no revisiting, game persists 24h in localStorage

Discover mode (venue recommendations):
    User enters city + list of artists
        → Phase 1: calls Supabase edge function for each artist (immediate results)
            → Edge function checks cache, falls back to Setlist.fm API
            → Stores venues + played_at relationships + toured_with
        → Phase 2: BFS in browser SQLite finds up to 5 connected bands
            → Fetches their venues in background, merges into results
        → Venues ranked by total show count across all queried artists
```

## File structure

```
src/
├── db/
│   └── graphDb.ts        — sql.js wrapper: load DB, BFS (with rel_type filter), neighbor queries, search.
│                           Runtime compilation filter (>25 degree albums skipped).
│                           Auto-detects gzip and decompresses if browser didn't.
├── game/
│   └── artists.ts        — Curated list of ~145 recognizable seed artists (97 persons, 48 groups).
├── graph/
│   ├── types.ts          — Node types, edge types, color maps.
│   ├── SceneGraph.ts     — In-memory graph with dedup/merge, persistence, expanded tracking.
│   └── expand.ts         — (Legacy) MusicBrainz API expansion. Unused now.
├── pages/
│   ├── ExplorePage.tsx   — Graph exploration via SQLite. Only person/group nodes. Albums filtered out.
│   ├── PlayPage.tsx      — Six Degrees game: BFS pathfinding, valid moves list with relationship labels,
│   │                       undo, sorted by rel_type priority, par scoring, reveal shortest path.
│   ├── DiscoverPage.tsx  — Venue recommendations: city + artists → venues. Progressive loading via BFS.
│   └── AboutPage.tsx     — Project info, data source credits, GitHub link.
├── components/
│   ├── Layout.tsx        — Shared nav bar with Explore/Play/About links.
│   ├── SearchBar.tsx     — Search input, expand, reset, settings. Responsive layout.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas (solid=expanded, outline=unexpanded).
│   ├── InfoPanel.tsx     — Side panel (desktop) / bottom sheet (mobile) for node details.
│   ├── Settings.tsx      — API key, Setlist.fm toggle, debug toggle, clear all data.
│   └── DebugConsole.tsx  — Collapsible log console.
├── api/
│   ├── supabase.ts       — Client for Supabase edge functions (venue search, aggregation).
│   ├── musicbrainz.ts    — (Legacy) Live MusicBrainz API client. Unused now.
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
├── process_mb_dump.py    — Downloads MusicBrainz dump, builds browser SQLite graph.
├── seed_supabase.py      — Seeds Supabase Postgres with MusicBrainz data (BFS-filtered).
├── crawl_setlistfm.py    — Daily crawl job for Setlist.fm venue data.
└── README.md             — Script documentation.

supabase/
├── functions/
│   └── venue-search/     — Edge function: on-demand venue lookup (artist + city → venues).
│                           Checks cache in Supabase, falls back to Setlist.fm API.
├── migrations/
│   └── 001_schema.sql    — PostgreSQL schema (artists, albums, venues, relationships).
├── config.toml           — Supabase project config.
└── README.md             — Deployment instructions.

docs/
└── SPACE_SAVING.md       — Ideas for reducing database storage if needed.

public/
├── graph.db.gz           — Precomputed SQLite graph (committed, ~61MB).
└── sql-wasm.wasm         — sql.js WASM binary (committed, ~660KB).

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
    rel_type TEXT NOT NULL  -- "member_of", "former_member_of", "support_musician",
                           -- "producer", "vocal", "instrument", "mix", "engineer", "recording"
);

-- Indexes: edges(source), edges(target), edges(rel_type), nodes(name COLLATE NOCASE), nodes(type)
```

## Key design decisions

- **SQLite in browser**: Precomputed graph loaded via sql.js WASM. ~61MB download (gzipped), instant queries.
- **Gzip auto-detection**: Checks first 2 bytes for gzip magic number (1f 8b). Decompresses manually if browser didn't (GitHub Pages). Skips if Vite already decompressed (Content-Encoding: gzip).
- **Game restricted to band relationships**: BFS and valid moves only use member_of, former_member_of, support_musician. Album credits stored but not used in gameplay (too complex for players).
- **Compilation filter (runtime)**: Album nodes with >25 connections skipped during BFS.
- **Membership deduplication**: For same (person, band) pair, if ANY relationship is not ended → stored as member_of (not former). Prevents Dave Grohl showing as "former member" of Foo Fighters.
- **Explore only shows artists**: Album nodes filtered from search results and neighbor expansion.
- **Game valid moves**: Scrollable list of all valid connections from current node. Sorted by relationship priority (members → former → support). Filter by typing. No revisiting. Undo support.
- **Par scoring**: Par = shortest path node count. Re-rolls if < 3 hops.
- **Seed artists**: ~145 recognizable names (persons + iconic bands). BFS at 6 hops builds the graph.
- **Same-type pairs**: Game always pairs person↔person or group↔group.
- **Vite base**: `/MusicSceneMap/` in production (GitHub Pages), `/` in dev.
- **graph.db.gz committed to repo**: 61MB, under GitHub's 100MB limit. Deployed with the site, same origin = no CORS.
- **No backend**: Everything client-side. Static file hosting only.
- **Game persistence**: 24h in localStorage. New Game clears and regenerates.
- **Responsive**: Mobile-friendly, bottom sheet InfoPanel, no keyboard on node click.

## Running

```bash
npm install
npm run dev
# Access at http://localhost:5173/
```

Requires `public/graph.db.gz` — either committed in repo or regenerated:

```bash
brew install zstd
python3 scripts/process_mb_dump.py
```

## Backend (Supabase)

PostgreSQL database on Supabase (free tier, 500MB). Stores the full graph + venue data.

**Schema** (`supabase/migrations/001_schema.sql`):
- `artists` — mbid, name, type, disambiguation, country
- `albums` — mbid, name, primary_artist_mbid, release_year, type
- `venues` — id, name, city, state, country
- `relationships` — source_id, target_id, rel_type, count

**Edge Function** (`supabase/functions/venue-search/`):
- On-demand venue lookup: frontend sends artist + city
- Checks Supabase for cached data, falls back to Setlist.fm API
- Stores results for future queries (data builds up from user interaction)

**Current size**: ~320MB (artists + albums + relationships). ~180MB headroom for venues.

## Deploying

**Frontend**: Push to `main`. GitHub Actions builds and deploys to Pages automatically.

**Edge Functions**:
```bash
supabase functions deploy venue-search --project-ref lwqkjtzqjgacgvfjiyxg
```

## What's missing / next steps

- **On-demand MusicBrainz refresh**: Edge function that checks if an artist's relationships are stale (e.g. >30 days) when queried, and fetches latest data from MusicBrainz API to update Supabase. Same pattern as venue-search but for band memberships and album credits. Handles new albums/collaborations appearing over time.
- **Expand seed list to ~300 artists**: More coverage across genres/eras, reduce MAX_HOPS to 4 for tighter graphs.
- **Genre/decade graph splits**: Separate smaller files per genre for faster downloads and focused game experiences.
- **Show album collaborators in Explore**: Collapse person→album→person into direct edges so producers/guests are visible.
- **Album→artist edges (album_by)**: Add edges linking albums to their primary artist/band (via `artist_credit_name` table). Enables "find contributors to Arctic Monkeys albums" directly.
- **Filter compilations in script**: Remove compilations at build time (release_group.type=11 or >25 contributors) in addition to runtime filter.
- **FTS5 search**: Full-text search for fuzzy name matching ("The Arctic Monkeys" → "Arctic Monkeys"). Include artist aliases.
- **Daily puzzle mode**: Same game for all users each day (date-seeded), shareable results, leaderboard.
- **Game difficulty levels**: Easy (short paths, famous artists only), Hard (longer paths, obscure connections).
- **Expand node on click**: Direct expansion from graph without search bar.
- **Legend on graph canvas**: Color key for node/edge types.
- **Scene detection**: Graph algorithms to identify communities/scenes automatically.
- **Travel mode**: Input a city, show relevant venues/scenes filtered by taste (requires venue data).
- **Setlist.fm integration**: Venue data, touring-together inference via shared date+venue.
- **PostgreSQL backend (future)**: For complex graph queries, venue recommendations, multi-user leaderboards.
