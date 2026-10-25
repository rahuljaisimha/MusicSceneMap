# MusicSceneMap — Project Summary

## What this is

A React app that visualizes music scene connections and includes a "Six Degrees of Music" game. Uses a precomputed SQLite database (from MusicBrainz data dumps) queried in the browser via WebAssembly. Deployed as a static site on GitHub Pages and/or Cloudflare (Workers Builds); see `docs/CDN_HOSTING.md`.

Features: **Explore** (graph visualization), **Play** (Six Degrees game), **Discover** (venue + concert recommendations), and **Similarity** (score how closely an artist fits a set of artists you like, using weighted graph relationships). Discover has a Venues/Concerts toggle — concerts are upcoming Pollstar events ranked by artist similarity. Discover and Similarity can fill their artist lists from the user's Spotify top artists. Every artist input (Explore search, Discover/Similarity lists, Play's custom game) has a search-as-you-type dropdown that labels same-name artists MusicBrainz-style: "Fuzz (US garage rock band · San Francisco)".

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
        → Python script extracts artists, band relationships, producer/vocal/instrument credits
        → Seeds: ~145 curated artists (6 hops) + every artist with a concert in the
          concert-database ledger (CONCERTDB_HOPS, default 6), BFS via member_of/support_musician
        → Deduplicates memberships (any active = current, not former)
        → Credits on another artist's record → one edge per role from the credited artist
          to the record's artist: produced_for, collaborated_with (no album nodes)
        → SQLite database: nodes (persons, groups) + edges + graph_meta
        → If graph.db.gz > 74 MB: rebuilt with one hop fewer around concert-database's
          artists until it fits (Supabase keeps the full set)
        → Output: public/graph.db.gz (~49MB, committed to repo; also uploaded to R2 for Cloudflare)
        → seed_supabase.py writes the same artists and edges (uncut) to Postgres
    concert-database ledger (~/concert-database/data/ledger.sqlite, read-only)
        → scripts/add_concertdb_edges.py adds opener → headliner "opened_for" edges
          (same pairs as `concertdb export --musicbrainz-only`), adding acts that
          aren't in the graph as nodes; re-runnable, replaces its previous edges

App loading (lazy, non-blocking):
    UI renders immediately; main.tsx calls preloadDb() once the browser is idle
        → Browser fetches graph.db.gz in the background
        → Auto-detects gzip (magic number 1f8b) and decompresses if needed
        → sql.js opens the SQLite database in WASM
        → From then on queries are local, instant (<50ms)
    Until it has loaded, lookups go to Postgres instead (the same artists, plus any the
    browser graph had to leave out to fit its size budget):
        → src/db/graphSource.ts: findArtist / findArtistById / getArtistNeighbors
          call the graph-neighbors edge function with log=0 (no search_misses rows)
        → Explore search, Discover's related-band BFS, Similarity and Concerts
          (via tieredGraphAccess) all work while the download is in progress
        → Play renders at once: a saved game shows in full (only its moves list
          waits), a shared link shows curated start/end names, and a new random
          game shows placeholders until BFS over the whole graph can pick one

Artist dropdown (ArtistAutocomplete, all artist inputs):
    User types ≥2 chars (artistSuggest.findSuggestions; database first)
        → Graph loaded: graphDb.searchArtists ranks graph artists instantly
          (exact > prefix > word-prefix > substring); only graph artists are offered.
          Labels from the graph's disambiguation/area columns (no request); older
          graphs without them get labels from one debounced Postgres search, by MBID
        → Graph not loaded yet, or no graph match: Postgres search (graph-neighbors
          ?q= mode; same ranking; never logs to search_misses)
        → MusicBrainz ONLY when the database has no match or can't be reached
          (prefix query; its results also carry a genre from the top tag)
        → Label: "Name (disambiguation · city · genre)", parts the disambiguation
          already mentions left out
        → Shows "Searching…" / "No matching artists" / "Couldn't load suggestions";
          re-runs when the graph finishes loading. Browser MusicBrainz calls send no
          custom headers (a User-Agent header would force a CORS preflight)
        → A pick carries the MBID: Explore and Play's custom game resolve by ID;
          Discover/Similarity add the name (they still resolve by name)

Explore mode:
    User searches artist (or picks from the dropdown)
        → sql.js queries SQLite for node + neighbors
        → Only person/group nodes shown (albums filtered out)
        → Relationships: member_of, former_member_of, support_musician shown by default;
          collaborated_with, produced_for, opened_for ticked on in the legend
          (GraphLegend: checkbox, colour and arrow direction per type; node
          colours; remembered in localStorage). Hidden types also hide the artists
          only they connect. Edges keep their stored direction (member → band, ...)
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
          relationships: direct edges and shared neighbors (bandmates, collaborators,
          shared headliners); album-credit scoring (albumCreditWeight) only applies
          to album nodes, which current graphs don't have
        → Each connection weighted by relationship type (REL_WEIGHTS):
          member_of > former_member_of > support_musician > collaborated_with >
          produced_for / opened_for
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

Spotify import (Discover + Similarity artist lists):
    User taps "Add my Spotify top artists"
        → Valid token in localStorage? → GET /v1/me/top/artists (10, medium_term)
        → Otherwise: PKCE sign-in redirect to Spotify (scope user-top-read),
          saving the route + current list in sessionStorage
        → Spotify redirects to the app root with ?code=...
        → main.tsx handleSpotifyRedirect() restores the route before the router
          mounts, exchanges the code for a token in the background
        → The page's button finishes the import: saved list + top artists,
          deduped case-insensitively
```

## File structure

```
src/
├── db/
│   ├── graphDb.ts        — sql.js wrapper: load DB, BFS (with rel_type filter), neighbor queries, search.
│   │                       Runtime compilation filter (>25 degree albums skipped).
│   │                       Auto-detects gzip and decompresses if browser didn't.
│   │                       preloadDb() starts the background download; a failed load can be retried.
│   │                       searchArtists() ranks name matches for the dropdown (uses the optional
│   │                       disambiguation/area columns when the graph has them).
│   ├── artistSuggest.ts  — Artist-dropdown suggestions: graph → Postgres search → MusicBrainz
│   │                       fallback (findSuggestions, sources injectable for tests); builds the
│   │                       "(disambiguation · city · genre)" label.
│   └── graphSource.ts    — Async artist lookups: local graph once loaded, else Postgres graph-neighbors
│                           (log=0, memoized). Used by Explore and Discover.
├── game/
│   └── artists.ts        — Curated list of 148 recognizable artists (name, type, MusicBrainz ID): the game's
│                           start/end points and the graph build's curated seeds (process_mb_dump.py reads it).
├── graph/
│   ├── types.ts          — Node types, edge types, color maps.
│   └── SceneGraph.ts     — In-memory graph with dedup/merge, persistence, expanded tracking.
├── pages/
│   ├── ExplorePage.tsx   — Graph exploration via SQLite. Only person/group nodes. Albums filtered out.
│   ├── PlayPage.tsx      — Six Degrees game: BFS pathfinding, valid moves list with relationship labels,
│   │                       undo, sorted by rel_type priority, par scoring, reveal shortest path.
│   │                       Supports random, custom (any two connected nodes), and shared (MBID URL) games.
│   │                       Renders before the graph downloads (skeleton start/end/par/moves until known).
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
│   ├── graphAccess.ts    — Shared builder for a graphDb-backed GraphAccess (core/Tier-1).
│   │                       Doesn't wait for the download; returns nothing until the DB has loaded.
│   ├── tieredGraphAccess.ts — Tiered GraphAccess: core sql.js → Postgres → MusicBrainz.
│   │                       Async prepareArtists() prefetch + sync build() facade. Used by Similarity + Concerts.
│   ├── searchResolution.ts — Pure logic: resolve an Explore search by MBID (just-clicked node) or by name.
│   └── AboutPage.tsx     — Project info, data source credits, GitHub link.
├── components/
│   ├── ArtistAutocomplete.tsx — Artist input + dropdown (keyboard, ARIA combobox, 44px rows on phones).
│   │                       Used by SearchBar, Discover, Similarity and Play's custom game.
│   ├── Layout.tsx        — Shared nav bar with Explore/Play/Discover/Similarity/About links.
│   │                       Inline tabs on desktop; hamburger menu below 640px.
│   ├── SearchBar.tsx     — Search input, expand, reset. Responsive layout.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas (solid=expanded, outline=unexpanded).
│   ├── GraphLegend.tsx   — Explore legend: per relationship type a checkbox, colour, arrow direction;
│   │                       node colours. Types and defaults in src/graph/relationships.ts.
│   ├── InfoPanel.tsx     — Side panel (desktop) / bottom sheet (mobile) for node details.
│   ├── SpotifyImportButton.tsx — "Add my Spotify top artists" button for artist-list pages.
│   │                       Hidden when no Spotify client ID is configured.
│   └── DebugConsole.tsx  — Collapsible log console, shown when the URL has ?debug=1 or ?debug=true.
├── api/
│   ├── supabase.ts       — Client for Supabase edge functions (venue search, aggregation).
│   ├── spotify.ts        — Spotify PKCE sign-in, token storage/refresh, top-artists fetch.
│   │                       handleSpotifyRedirect() runs in main.tsx before the router.
│   ├── pollstar.ts       — Browser Pollstar client: venue autocomplete + upcoming events.
│   │                       ~1 req/sec pacing (first fires ASAP), 24h cache, CORS via proxy.
│   ├── musicbrainz.ts    — Live MusicBrainz API client (1 req/sec). Fallback only: Tier-3 lookups and
│   │                       dropdown suggestions the database has no match for (searchArtistsPrefix).
│   └── cache.ts          — localStorage request cache with TTL (used by pollstar.ts, 24h).
├── debug/
│   └── DebugLog.ts       — Singleton log store. Enabled by debug=1/true in the query string or the
│                           hash route's query (#/explore?debug=1); stays on until a reload without it.
├── test/
│   ├── setup.ts          — Vitest setup (localStorage shim for Node env).
│   ├── musicbrainz.integration.test.ts — Regression tests for recurring MB bugs (stubbed fetch).
│   ├── similarity.test.ts / concerts.test.ts — Scoring and concert-ranking logic.
│   ├── tieredGraphAccess.test.ts — Tier fallback order, caching, miss recording.
│   ├── searchResolution.test.ts  — MBID-vs-name search resolution.
│   ├── artistSuggest.test.ts     — Dropdown suggestion merging and labels.
│   └── fixtures/         — Captured MusicBrainz API responses (search-fuzz, artist-arctic-monkeys, etc.).
├── App.tsx               — Router (HashRouter, 5 routes: Explore, Play, Discover, Similarity, About).
├── main.tsx              — Entry point.
├── vite-env.d.ts         — Vite type declarations.
├── sql.js.d.ts           — sql.js type declarations.
└── index.css             — Dark theme, mobile styles (max-width: 640px block), highlight animation.

scripts/
├── process_mb_dump.py    — Downloads MusicBrainz dump, builds browser SQLite graph: curated + concert-database
│                           seeds, person/group nodes, band edges, produced_for / collaborated_with edges
│                           (build_collaborations). Fits the download to MAX_GZIP_MB. load_graph_inputs() is
│                           shared with seed_supabase.py.
├── add_concertdb_edges.py — Adds "opened_for" edges (opener → headliner) to graph.db.gz from the
│                           concert-database ledger. Run after process_mb_dump.py.
├── seed_supabase.py      — Seeds Supabase Postgres with the same artists and edges, uncut (--dry-run counts rows).
├── crawl_setlistfm.py    — Daily crawl job for Setlist.fm venue data.
└── README.md             — Script documentation.

supabase/
├── functions/
│   ├── venue-search/     — Edge function: on-demand venue lookup (artist + city → venues).
│   │                       Resolves via DB then MusicBrainz. Caches, detects toured_with.
│   ├── report-miss/      — Edge function: logs artists missing from browser SQLite.
│   └── graph-neighbors/  — Edge function (Tier 2): artist + 1-hop neighbors from Postgres.
│                           Logs misses to search_misses (graph-neighbors-not-found) unless log=0.
│                           ?q= search mode for the artist dropdowns (never logs).
├── migrations/
│   ├── 001_schema.sql    — PostgreSQL schema (artists, albums, venues, relationships).
│   ├── 002_crawl_log.sql — Data freshness tracking.
│   ├── 003_search_misses.sql — Unknown artist query logging.
│   ├── 004_artist_search.sql — pg_trgm index on artists.name, artists.area column.
│   └── 005_collaborations.sql — Drops albums + per-album credit rows and two redundant indexes
│                           (then VACUUM FULL relationships; re-seed; redeploy graph-neighbors).
├── config.toml           — Supabase project config.
└── README.md             — Deployment instructions.

docs/
├── CDN_HOSTING.md        — Hosting graph.db.gz on Cloudflare R2; Cloudflare deploy setup.
└── SPACE_SAVING.md       — Ideas for reducing database storage if needed.

public/
├── graph.db.gz           — Precomputed SQLite graph (committed, ~49MB).
├── .assetsignore         — Keeps graph.db.gz out of the Cloudflare upload (25 MiB asset cap).
└── sql-wasm.wasm         — sql.js WASM binary (committed, ~660KB).

.github/workflows/
└── deploy.yml            — GitHub Actions: build and deploy to GitHub Pages.

wrangler.jsonc            — Cloudflare Workers config (static assets; `previews` block for PR builds).
CLAUDE.md                 — Instructions for Claude Code sessions (imports this file).
```

## SQLite schema

```sql
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,    -- MusicBrainz GID
    name TEXT NOT NULL,
    type TEXT NOT NULL,     -- "person", "group"
    disambiguation TEXT,    -- MusicBrainz comment, e.g. "US garage rock band" (~36% of artists)
    area TEXT               -- begin area (usually a city), else area (~72% of artists)
);

CREATE TABLE edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    rel_type TEXT NOT NULL  -- "member_of", "former_member_of", "support_musician",
                            -- "collaborated_with" / "produced_for" (source sang/played on, or produced,
                            --   target's records), "opened_for" (source opened for target; concert-database)
);

CREATE TABLE graph_meta (key TEXT PRIMARY KEY, value TEXT);   -- build info: dump, seeds, hops; opened_for counts
CREATE TABLE graph_meta_added_nodes (value TEXT PRIMARY KEY); -- acts it added (so a re-run can drop stale ones)

-- Indexes: edges(source), edges(target), edges(rel_type), nodes(name COLLATE NOCASE), nodes(type)
--
-- The pipeline (process_mb_dump.py) emits person/group nodes only (no album
-- nodes); credits become artist -> record-artist collaborated_with / produced_for
-- edges (older graphs had person<->person "collaborator" edges; similarity.ts
-- still weighs them). Graphs older than the disambiguation/area columns still
-- load: searchArtists checks PRAGMA table_info and the dropdown then gets
-- labels from Postgres.
```

## Key design decisions

- **SQLite in browser**: Precomputed graph loaded via sql.js WASM. ~49MB download (gzipped, kept under 74MB; loaded in the background), instant queries.
- **Lazy graph loading**: Pages never wait for the graph download. It starts in the background after the first render (`preloadDb()` in `main.tsx`), and until it finishes `graphSource.ts` and the tiered access answer from Postgres `graph-neighbors`, which holds the same dataset. Those requests pass `log=0`, and Discover's `sqlite-missing` report only runs when the lookup was checked against the local graph, so nothing is added to `search_misses` while the graph is downloading. Postgres only returns 1-hop neighborhoods, so Similarity scores computed before the download finishes can be less precise. Play renders immediately too: a saved game (or a reload of one) shows its start, end and path at once, a shared link shows the start and end when they are curated artists, and everything else (a new random game's artists, the par, the list of moves) shows as placeholders until the graph is in, since picking a game and listing moves need the whole graph.
- **Gzip auto-detection**: Checks first 2 bytes for gzip magic number (1f 8b). Decompresses manually if browser didn't (GitHub Pages). Skips if Vite already decompressed (Content-Encoding: gzip).
- **Game restricted to band relationships**: BFS and valid moves only use member_of, former_member_of, support_musician. Collaborations and opened_for are not used in gameplay (too loose a tie for the puzzle).
- **Compilation filter (runtime)**: Album nodes with >25 connections skipped during BFS. A no-op now that graphs have no album nodes; kept for older graph files.
- **Membership deduplication**: For same (person, band) pair, if ANY relationship is not ended → stored as member_of (not former). Prevents Dave Grohl showing as "former member" of Foo Fighters.
- **Explore only shows artists**: Album nodes (only in old graph files) filtered from search results and neighbor expansion. Directed edges (opened_for, collaborated_with, produced_for) are drawn source → target whichever end was expanded.
- **Artist dropdown: database first, MusicBrainz as fallback only**: ~1,500 names in the graph belong to more than one artist (four "Fuzz"es), so suggestions carry a MusicBrainz-style parenthetical from the database's `disambiguation` and `area` (both pipelines now write them; Postgres already has `disambiguation`). Suggestions come from the local graph, else Postgres via `graph-neighbors`' `?q=` search mode (which never logs misses; it shares the function with the `log=0` lookups rather than adding a second one); MusicBrainz is asked only when the database has no match or is unreachable. Only graph artists are suggested once the graph has loaded and matches, so every pick can be expanded. Genre is only shown for MusicBrainz fallback results (tags aren't in the main dump).
- **Concert recommendations (Pollstar, client-side)**: Discover's Concerts toggle fetches upcoming events live in the browser (kept fresh, 24h localStorage cache) rather than via a backend — so results are always current and there's no scrape job to maintain. Pollstar requests are paced ~1 req/sec (first fires immediately) with a realistic UA; CORS handled by Vite dev proxy / corsproxy.io in prod. Concerts are ranked by headline-artist similarity reusing `similarity.ts` via a shared `graphAccess.ts` adapter. Artists absent from the graph score 0 and rank last (shown, flagged) — hit rate is a known future improvement (more graph artists / backend fallback). Ranking logic (`concerts.ts`) is pure and unit-tested; only the fetch layer touches the network.
- **Tiered graph coverage (Option 4)**: `src/pages/tieredGraphAccess.ts` wraps the core sql.js `GraphAccess` and, for artists NOT in the core graph, falls back through Tier 2 (Postgres `graph-neighbors` edge function) → Tier 3 (MusicBrainz live). (Discogs is a planned Tier 4, deferred.) Because the scorer's `GraphAccess` is synchronous but Tier 2/3 are async, it works in two phases: `prepareArtists(names)` (async prefetch of out-of-core artists → node + 1-hop neighbors, cached 24h, concurrent dupes deduped/shared) then `build()` returns a sync facade (core first, then overlay). Similarity and Concerts call `prepareArtists` before scoring, so out-of-core artists (esp. small concert headliners) now resolve instead of scoring 0. Tier 2 returns 1 hop only — reduced multi-hop accuracy for out-of-core artists is an accepted tradeoff. Postgres holds every artist the build reaches, never cut for size (plus the artists of records they worked on), so it covers what the browser graph leaves out when the size budget trims it; MusicBrainz (Tier 3) covers the rest.
- **Collaborations instead of albums**: a producer, vocal, instrument or performer credit on another artist's record becomes one directed edge from the credited artist to the record's (release group's) first credited artist: `produced_for` for producing, `collaborated_with` for singing/playing/performing (Josh Homme → Arctic Monkeys for Humbug). Engineering credits (mix, engineer, recording), credits on an artist's own records, credits between a band and its current or former members (the membership edge already covers them) and "Various Artists" compilations are left out. Postgres keeps the number of song credits in `relationships.count`; the browser graph has no count column. No album nodes or album table anywhere (it replaced person↔person `collaborator` co-credit pairs, about half as many edges). Weights (placeholders): `collaborated_with` 0.5, `produced_for` 0.45.
- **Seeds and size budget**: the graph is every artist within 6 hops of the curated seeds and within `CONCERTDB_HOPS` (default 6) of each artist with a concert in concert-database, over band relationships. The browser download is held under 74 MB: if `graph.db.gz` comes out over `MAX_GZIP_MB` (74), `process_mb_dump.py` rebuilds it with one hop fewer around concert-database's artists. The limit can be generous because the download never blocks a page (lazy loading, Postgres answers meanwhile). Postgres is never cut, so Tier 2 covers what the browser graph leaves out. `graph_meta` records the hops used.
- **Game valid moves**: Scrollable list of all valid connections from current node. Sorted by relationship priority (members → former → support). Filter by typing. No revisiting. Undo support.
- **Par scoring**: Par = shortest path node count. Re-rolls if < 3 hops.
- **Seed artists**: 148 recognizable artists (persons + iconic bands) at 6 hops, the game's puzzle endpoints; plus concert-database's artists (see "Seeds and size budget"). Listed once, in `src/game/artists.ts`, by MusicBrainz ID with the name for readability: names are ambiguous (several "Lemmy"s, five "Nirvana"s) or change ("Kanye West" is "Ye" on MusicBrainz), and the build used to pick an arbitrary namesake. The game resolves them by ID too; a seed missing from the dump is reported by the build.
- **Concert ties from concert-database**: `scripts/add_concertdb_edges.py` reads the concert-database ledger (read-only; data flows one way, concert-database never reads the graph) and adds one `opened_for` edge per (opener, headliner) pair: both matched to MusicBrainz, not a festival, not cancelled, billing confidence ≥ 0.4. Every act in these pairs has a concert, so the build's concert-database seeds already put it in the graph; an act missing from an older or trimmed graph is added as a node (name, type, disambiguation; no area). `graphDb.getNeighbors` reports each edge's direction (`outgoing`) so Explore draws opener → headliner; Similarity weighs `opened_for` at 0.45 (placeholder, below band ties, above a single album credit) and labels "opened for / headlined". The game and Discover's related-band BFS ignore it (they use band relationships only). Postgres (`graph-neighbors`) doesn't have these edges yet.
- **Same-type pairs**: Game always pairs person↔person or group↔group.
- **Vite base (host-aware)**: `vite.config.ts` sets `base` by precedence: explicit `DEPLOY_BASE` env var → Cloudflare build (`WORKERS_CI` from Workers Builds, or `CF_PAGES` from Pages) → `/` → GitHub Pages production default `/MusicSceneMap/` → dev `/`. Cloudflare serves at the domain root, so the GitHub Pages base there causes a blank page (404'd assets) — hence the auto-detection. It also inlines the R2 graph URL on Cloudflare builds (see `__GRAPH_DB_CDN_URL__`), since static-assets-only Workers can't hold env vars.
- **graph.db.gz loader (local-first, CDN fallback)**: `graphDb.ts` tries the same-origin committed file first, then falls back to the CDN URL (`VITE_GRAPH_DB_URL` or the build-time `__GRAPH_DB_CDN_URL__`) if the local file is missing/HTML-fallback. On Cloudflare the local file is excluded from upload via `public/.assetsignore` (25 MiB asset cap), so it loads from R2.
- **graph.db.gz committed to repo**: Deployed with the site, same origin = no CORS. Fits GitHub's 100MB file limit. **Cloudflare Pages caps static assets at 25 MiB**, below the file size — to deploy there, host `graph.db.gz` on a CDN and set `VITE_GRAPH_DB_URL` (see `docs/CDN_HOSTING.md`). `graphDb.ts` uses `VITE_GRAPH_DB_URL || same-origin file`. **GitHub Releases was tried and rejected**: release-asset URLs 302-redirect to `objects.githubusercontent.com` without reliable `Access-Control-Allow-Origin`, so cross-origin `fetch` fails CORS. Use Cloudflare R2 (free egress, controllable CORS policy, serves raw gzip bytes so the magic-number decompression path still works) or jsDelivr.
- **Mostly client-side**: The site is static (GitHub Pages / Cloudflare) and graph queries run in the browser. Network calls are limited to Supabase edge functions (venue search, Tier-2 graph lookups, miss reporting), MusicBrainz (Tier-3 fallback), Pollstar (concerts) and Spotify (optional top-artist import).
- **Spotify import (PKCE, client-side)**: Authorization Code + PKCE needs no client secret, so it fits the static site; the client ID is public and inlined at build (`__SPOTIFY_CLIENT_ID__` in `vite.config.ts`, overridable with `VITE_SPOTIFY_CLIENT_ID`). Sign-in is a full-page redirect (more reliable on phones than a popup), so the button saves the current list and route before leaving and restores both on return. Only the read-only `user-top-read` scope is requested. Tokens live in localStorage and are refreshed with the refresh token; any other in-progress form input (e.g. Discover's city) is not preserved across the first sign-in.
- **Game persistence**: 24h in localStorage. New Game clears and regenerates.
- **Responsive**: Phone layouts come from one `@media (max-width: 640px)` block in `index.css` that targets class hooks on components (inline styles stay the desktop default). Below 640px: hamburger nav, one-row Explore toolbar, bottom-sheet InfoPanel, 44px tap targets, safe-area insets. Tested at 320px and 390px with no horizontal scroll.

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

When hosting the graph on R2 (Cloudflare), re-upload after a regen:

```bash
npm run add-concerts   # refresh the "opened_for" edges from the concert-database ledger
npm run upload-graph   # upload public/graph.db.gz to R2 (wrangler, --remote)
npm run regen-graph    # regenerate (MusicBrainz + concert-database) then upload in one step
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

`src/test/artistSuggest.test.ts` covers the artist dropdown: source order (graph labels with no request; Postgres labels by MBID; Postgres while the graph downloads; MusicBrainz only when the database has no match or is down), MusicBrainz field mapping (begin area over area, top tag as genre), and the parenthetical label.

`src/test/tieredGraphAccess.test.ts` covers the tiered fallback (core → Postgres → MusicBrainz), Tier-2 caching, per-session dedupe, and miss recording. `src/test/searchResolution.test.ts` covers Explore's MBID-vs-name search resolution.

`src/test/concerts.test.ts` unit-tests the concert-ranking logic (`src/pages/concerts.ts`) and Pollstar response parsing (`src/api/pollstar.ts`). Covers: headline-artist selection, ranking graph-known artists above unknowns (score 0), tie-break by soonest date, per-artist score memoization, supporting-artist listing, event dedupe, and `parseVenues`/`parseEvents`/`formatPollstarDate` field mapping. All offline (no network).

## Backend (Supabase)

PostgreSQL database on Supabase (free tier, 500MB). Stores the full graph + venue data.

**Schema** (`supabase/migrations/`):
- `artists` — mbid, name, type, disambiguation, country, area (migration 004)
- `venues` — id, name, city, state, country
- `relationships` — source_id, target_id, rel_type, count. Seeded: band relationships and `collaborated_with` / `produced_for` (count = song credits); `played_at` / `toured_with` from venue-search. Album table and per-album credit rows removed in migration 005.
- `crawl_log` — artist_mbid, city, last_fetched (tracks data freshness, 14-day stale threshold)
- `search_misses` — query, source, created_at (tracks unknown artist lookups)

**Edge Functions** (`supabase/functions/`):
- `venue-search` — On-demand venue lookup: resolves artist (DB → MusicBrainz fallback), checks cache, fetches Setlist.fm, stores results, detects touring partners. Adds missing artists to DB automatically.
- `report-miss` — Lightweight POST endpoint for frontend to report artists missing from browser SQLite.
- `graph-neighbors` — Tier-2 graph lookup: artist + 1-hop neighbors from Postgres for artists missing from the browser SQLite, and for every lookup while that graph is still downloading. `log=0` skips the miss log. `?q=` is a search mode for the artist dropdowns (ranked matches with disambiguation and area, no neighbors, never logs).

**Search miss tracking**:
- `sqlite-missing` — in Supabase DB but not browser SQLite (frontend reports via report-miss)
- `venue-search-missing-artist` — resolved via MusicBrainz, added to Supabase (edge function logs)
- `venue-search-not-found` — not found anywhere, likely mistype (edge function logs)

**Size**: was ~320MB with albums and per-album credits. With the collaborations model and the concert-database seeds, 237MB after re-seeding (Supabase dashboard → Settings → Usage).

## Deploying

**Frontend (GitHub Pages)**: Push to `main`. GitHub Actions builds and deploys to Pages automatically (base `/MusicSceneMap/`, graph served same-origin).

**Frontend (Cloudflare, Workers Builds)**: Build command `npm run build`, deploy `npx wrangler deploy`, output `dist`. No env vars needed — the build auto-detects Cloudflare (`WORKERS_CI`) to set base `/` and inline the R2 graph URL. `public/.assetsignore` keeps the oversized `graph.db.gz` out of the upload (25 MiB cap); the app loads it from R2. R2 bucket needs public access + a CORS policy allowing the site origins. Full setup in `docs/CDN_HOSTING.md`.

**PR previews**: Cloudflare builds every PR branch with `npx wrangler preview` (needs the `previews` block in `wrangler.jsonc`). The `cloudflare-workers-and-pages` bot comments on the PR with the preview URL and build status.

**Spotify import**: The Spotify app's Client ID is set in `SPOTIFY_CLIENT_ID` in `vite.config.ts` (a new app at developer.spotify.com → Web API needs its own ID pasted there). Add every site URL the app is served from as a Redirect URI. It must match `origin + base` exactly, with no wildcards: e.g. the Cloudflare production URL with a trailing `/`, `https://rahuljaisimha.github.io/MusicSceneMap/`, and `http://127.0.0.1:5173/` for local dev (Spotify rejects `localhost`). PR preview URLs differ per branch, so register a preview's URL to test sign-in there. In Development mode only Spotify accounts added under the app's User Management can sign in.

**Edge Functions** (full list in `supabase/README.md`):
```bash
supabase functions deploy venue-search --no-verify-jwt --project-ref lwqkjtzqjgacgvfjiyxg
supabase functions deploy report-miss --no-verify-jwt --project-ref lwqkjtzqjgacgvfjiyxg
supabase functions deploy graph-neighbors --no-verify-jwt --project-ref lwqkjtzqjgacgvfjiyxg
```
Run `migrations/004_artist_search.sql` for fast dropdown search (`graph-neighbors` `?q=` works without it, just slower and with no `area`), and re-run `seed_supabase.py` to fill `area`. Run `migrations/005_collaborations.sql`, then `VACUUM FULL relationships;` on its own, before re-seeding with the collaborations model.

## What's missing / next steps

- **On-demand MusicBrainz refresh**: Edge function that checks if an artist's relationships are stale (e.g. >30 days) when queried, and fetches latest data from MusicBrainz API to update Supabase. Same pattern as venue-search but for band memberships and collaborations. Handles new records/collaborations appearing over time.
- **opened_for in Postgres**: seed `opened_for` edges into `relationships` too (graph-neighbors already returns the type).
- **Weight collaborations by count**: Postgres has the song-credit count per collaboration; the browser graph doesn't yet (it would cost download size).
- **Genre/decade graph splits**: Separate smaller files per genre for faster downloads and focused game experiences.
- **FTS5 search**: Full-text search for fuzzy name matching ("The Arctic Monkeys" → "Arctic Monkeys"). Include artist aliases.
- **Daily puzzle mode**: Same game for all users each day (date-seeded), shareable results, leaderboard.
- **Game difficulty levels**: Easy (short paths, famous artists only), Hard (longer paths, obscure connections).
- **Expand node on click**: Direct expansion from graph without search bar.
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
