# MusicSceneMap — Project Summary

## What this is

A React app that visualizes music scene connections and includes a "Six Degrees of Music" game. Uses a precomputed SQLite database (from MusicBrainz data dumps) queried in the browser via WebAssembly. Deployed as a static site on GitHub Pages.

Features: **Explore** (graph visualization), **Play** (Six Degrees game), **Discover** (venue + concert recommendations), and **Similarity** (score how closely an artist fits a set of artists you like, using weighted graph relationships). Discover has a Venues/Concerts toggle — concerts are upcoming Pollstar events ranked by artist similarity.

## Tech stack

- Vite + React 18 + TypeScript
- react-router-dom (HashRouter for GitHub Pages compatibility)
- react-force-graph-2d for graph visualization
- sql.js (SQLite compiled to WASM) for in-browser graph queries
- In-memory SceneGraph with localStorage persistence (Explore view)
- Python script for processing MusicBrainz data dumps into SQLite
- Vitest for testing (offline, fixture-based)

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
    Custom game → user picks any two connected artists/bands (no same-type requirement)
    Shared game → URL params (?start=<mbid>&end=<mbid>) load the exact same puzzle;
                  Share button copies an MBID-based link (avoids name ambiguity)

Discover mode (venue recommendations):
    User enters city + list of artists
        → Phase 1: calls Supabase edge function for each artist (immediate results)
            → Edge function resolves artist (DB → MusicBrainz fallback → adds if new)
            → Checks cache (14-day stale threshold), falls back to Setlist.fm API
            → Stores venues + played_at relationships + toured_with
        → Phase 2: BFS in browser SQLite finds up to 5 connected bands
            → Reports artists missing from SQLite via report-miss function
            → Fetches their venues by MBID in background, merges into results
        → Venues ranked by total show count across all queried artists

Similarity mode (artist-to-scene fit scoring):
    User enters a list of artists + one target artist to compare
        → Loads browser SQLite (same DB as Explore/Play)
        → For each list artist, collects connections to the target across ALL
          relationships: direct edges, shared neighbors, and shared album credits
        → Each connection weighted by relationship type (REL_WEIGHTS):
          member_of > former_member_of > support_musician; album credits scored
          by shared-credit count (albumCreditWeight, diminishing returns)
        → Per-pair score = 70% connection strength + 30% BFS proximity (all rels)
        → Overall = 60% best pair + 40% average (rewards multiple independent paths)
        → Fully client-side; no backend. Weights are placeholders, tunable in similarity.ts

Discover — Concerts mode (upcoming event recommendations):
    User toggles to "Concerts", enters city + artists
        → Runs the venue search to get the city's top venue NAMES
        → Resolves each to a Pollstar venue via autocomplete (matches city)
        → Fetches upcoming events per venue from Pollstar (fromDate = today)
        → Ranks each concert by headline-artist similarity to the list (similarity.ts)
        → Artists not in the graph score 0, shown but ranked last (flagged)
        → Pollstar calls run in-browser: ~1 req/sec pacing (first fires ASAP),
          24h localStorage cache. CORS via Vite dev proxy / corsproxy.io in prod.
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
│   │                       Supports random, custom (any two connected nodes), and shared (MBID URL) games.
│   ├── DiscoverPage.tsx  — Venue + concert recommendations. Venues/Concerts toggle. Venues: city + artists
│   │                       → venues (progressive BFS). Concerts: top venues → Pollstar upcoming events,
│   │                       ranked by headline-artist similarity (similarity.ts).
│   ├── SimilarityPage.tsx — Similarity Score: list of artists + target artist → 0–100 fit score.
│   │                       Wires graphDb into the similarity.ts GraphAccess; renders weighted breakdown.
│   ├── similarity.ts     — Pure scoring logic (GraphAccess interface, testable without sql.js).
│   │                       REL_WEIGHTS per relationship type (placeholders), album-credit weighting,
│   │                       per-pair + aggregate scoring, scoreArtistAgainstList helper. Uses ALL relationships.
│   ├── concerts.ts       — Pure concert-ranking logic: flatten Pollstar events, score headline artist
│   │                       via similarity.ts, sort by score then date. Memoizes per-artist scores.
│   ├── graphAccess.ts    — Shared builder for a graphDb-backed GraphAccess (used by Similarity + Concerts).
│   └── AboutPage.tsx     — Project info, data source credits, GitHub link.
├── components/
│   ├── Layout.tsx        — Shared nav bar with Explore/Play/Discover/Similarity/About links.
│   ├── SearchBar.tsx     — Search input, expand, reset, settings. Responsive layout.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas (solid=expanded, outline=unexpanded).
│   ├── InfoPanel.tsx     — Side panel (desktop) / bottom sheet (mobile) for node details.
│   ├── Settings.tsx      — API key, Setlist.fm toggle, debug toggle, clear all data.
│   └── DebugConsole.tsx  — Collapsible log console.
├── api/
│   ├── supabase.ts       — Client for Supabase edge functions (venue search, aggregation).
│   ├── pollstar.ts       — Browser Pollstar client: venue autocomplete + upcoming events.
│   │                       ~1 req/sec pacing (first fires ASAP), 24h cache, CORS via proxy.
│   ├── musicbrainz.ts    — (Legacy) Live MusicBrainz API client. Unused now.
│   ├── setlistfm.ts      — (Legacy) Live Setlist.fm API client.
│   └── cache.ts          — localStorage request cache with TTL (used by pollstar.ts, 24h).
├── debug/
│   └── DebugLog.ts       — Singleton log store.
├── test/
│   ├── setup.ts          — Vitest setup (localStorage shim for Node env).
│   ├── musicbrainz.integration.test.ts — Regression tests for recurring MB bugs (stubbed fetch).
│   └── fixtures/         — Captured MusicBrainz API responses (search-fuzz, artist-arctic-monkeys, etc.).
├── App.tsx               — Router (HashRouter, 5 routes: Explore, Play, Discover, Similarity, About).
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
│   ├── venue-search/     — Edge function: on-demand venue lookup (artist + city → venues).
│   │                       Resolves via DB then MusicBrainz. Caches, detects toured_with.
│   └── report-miss/      — Edge function: logs artists missing from browser SQLite.
├── migrations/
│   ├── 001_schema.sql    — PostgreSQL schema (artists, albums, venues, relationships).
│   ├── 002_crawl_log.sql — Data freshness tracking.
│   └── 003_search_misses.sql — Unknown artist query logging.
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
- **Concert recommendations (Pollstar, client-side)**: Discover's Concerts toggle fetches upcoming events live in the browser (kept fresh, 24h localStorage cache) rather than via a backend — so results are always current and there's no scrape job to maintain. Pollstar requests are paced ~1 req/sec (first fires immediately) with a realistic UA; CORS handled by Vite dev proxy / corsproxy.io in prod (same pattern as setlistfm). Concerts are ranked by headline-artist similarity reusing `similarity.ts` via a shared `graphAccess.ts` adapter. Artists absent from the graph score 0 and rank last (shown, flagged) — hit rate is a known future improvement (more graph artists / backend fallback). Ranking logic (`concerts.ts`) is pure and unit-tested; only the fetch layer touches the network.
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

## Testing

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Vitest tests in `src/test/musicbrainz.integration.test.ts` are regression guards for bugs that recurred during development. They use real MusicBrainz API responses captured as fixtures (`src/test/fixtures/`) with `fetch` stubbed — offline, deterministic, fast (~140ms). Covered cases:
- Exact name match vs relevance ranking (Fuzz vs Buzz Fuzz)
- Same-name disambiguation (multiple "Jack White")
- Current vs former member dedup (member current if any relationship not ended)
- Bands dedup (Nirvana appears twice in Dave Grohl's raw relations)
- Supporting musician extraction (Arctic Monkeys → Tom Rowley, Tyler Parkford)

The rate limiter in `mbFetch` is skipped when `process.env.VITEST` is set. To refresh a fixture, re-capture the MusicBrainz API response for the relevant MBID.

`src/test/similarity.test.ts` unit-tests the Similarity scoring logic (`src/pages/similarity.ts`) against an in-memory fake graph (no sql.js needed). Covers: relationship-weight ordering (member_of > former_member_of > support_musician > album credits), album-credit weighting by shared-credit count with saturation, connection detection (shared bandmates and shared albums), band-tied vs album-only ranking, unreachable artists scoring zero, unknown/not-found artists, breakdown sort order, and the best/average aggregate.

`src/test/concerts.test.ts` unit-tests the concert-ranking logic (`src/pages/concerts.ts`) and Pollstar response parsing (`src/api/pollstar.ts`). Covers: headline-artist selection, ranking graph-known artists above unknowns (score 0), tie-break by soonest date, per-artist score memoization, supporting-artist listing, event dedupe, and `parseVenues`/`parseEvents`/`formatPollstarDate` field mapping. All offline (no network).

## Backend (Supabase)

PostgreSQL database on Supabase (free tier, 500MB). Stores the full graph + venue data.

**Schema** (`supabase/migrations/`):
- `artists` — mbid, name, type, disambiguation, country
- `albums` — mbid, name, primary_artist_mbid, release_year, type
- `venues` — id, name, city, state, country
- `relationships` — source_id, target_id, rel_type, count
- `crawl_log` — artist_mbid, city, last_fetched (tracks data freshness, 14-day stale threshold)
- `search_misses` — query, source, created_at (tracks unknown artist lookups)

**Edge Functions** (`supabase/functions/`):
- `venue-search` — On-demand venue lookup: resolves artist (DB → MusicBrainz fallback), checks cache, fetches Setlist.fm, stores results, detects touring partners. Adds missing artists to DB automatically.
- `report-miss` — Lightweight POST endpoint for frontend to report artists missing from browser SQLite.

**Search miss tracking**:
- `sqlite-missing` — in Supabase DB but not browser SQLite (frontend reports via report-miss)
- `venue-search-missing-artist` — resolved via MusicBrainz, added to Supabase (edge function logs)
- `venue-search-not-found` — not found anywhere, likely mistype (edge function logs)

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
- **Upcoming shows / Concert Finder (IMPLEMENTED via Pollstar)**: Discover → Concerts toggle recommends upcoming concerts at a city's top venues, ranked by artist similarity. Data-source investigation history:
  - **Setlist.fm API** — only has *past* setlists, no upcoming shows. Website has upcoming shows on venue pages (`upcomingSetlistsList`) and they scrape cleanly, but listings are sparse.
  - **Songkick** — has more complete upcoming show data, but the website blocks scraping (HTTP 406, aggressive bot protection) and the official API requires a paid commercial partnership (no free/hobbyist tier).
  - **JamBase** — excellent fit (MBID-keyed via `/v3/artists/id/musicbrainz:{mbid}`, aggregates 25+ ticketing sources, structured data), but only a 14-day free trial then paid.
  - **Ticketmaster Discovery API** — free, but only lists LiveNation/Ticketmaster events (limited coverage).
  - **Songkick API** with MBID support (`/artists/mbid:{mbid}/calendar`) would be ideal but is paid-only.
  - **Pollstar (IMPLEMENTED)** — Pollstar's website backs onto public JSON endpoints that return genuine *upcoming* events with artist names, dates, and ticket links: autocomplete (`autocomplete.pollstar.com/global/All/100/{q}`, filter EntityType=Venue) and events (`www.pollstar.com/api/companies/{venueId}/events?fromDate=...`). `fromDate` must be today-or-later (past dates are subscription-gated). This powers the Discover → Concerts toggle: top venues → Pollstar events → ranked by headline-artist similarity. Fetched in-browser (CORS via proxy), ~1 req/sec, 24h cache. Artists not in the graph score 0 and rank last. See `src/api/pollstar.ts` + `src/pages/concerts.ts`.
  - **Original decision (superseded)**: Parked pending a free MBID-compatible source; Pollstar's public endpoints filled that gap.
  - **Future hit-rate improvements**: more artists in the SQLite graph, a backend fallback lookup when an artist isn't in the graph, or MBID resolution via MusicBrainz to enrich matching.
- **Setlist.fm integration**: Venue data, touring-together inference via shared date+venue.
- **PostgreSQL backend (future)**: For complex graph queries, venue recommendations, multi-user leaderboards.
