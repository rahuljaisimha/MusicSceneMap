# MusicSceneMap — Project Summary

## What this is

A React app that visualizes music scene connections and includes a "Six Degrees of Music" game. Uses a precomputed SQLite database (from MusicBrainz data dumps) queried in the browser via WebAssembly. Deployed as a static site on GitHub Pages and/or Cloudflare (Workers Builds); see `docs/CDN_HOSTING.md`.

Features: **Explore** (graph visualization), **Play** (Six Degrees game), **Discover** (venue + concert recommendations), and **Similarity** (score how closely an artist fits a set of artists you like, using weighted graph relationships). Discover has a Venues/Concerts toggle — concerts are upcoming Pollstar events ranked by artist similarity. Discover and Similarity can fill their artist lists from the user's Spotify top artists.

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
        → Output: public/graph.db.gz (~38MB, committed to repo; also uploaded to R2 for Cloudflare)

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
│   ├── graphAccess.ts    — Shared builder for a graphDb-backed GraphAccess (core/Tier-1).
│   ├── tieredGraphAccess.ts — Tiered GraphAccess: core sql.js → Postgres → MusicBrainz.
│   │                       Async prepareArtists() prefetch + sync build() facade. Used by Similarity + Concerts.
│   ├── searchResolution.ts — Pure logic: resolve an Explore search by MBID (just-clicked node) or by name.
│   └── AboutPage.tsx     — Project info, data source credits, GitHub link.
├── components/
│   ├── Layout.tsx        — Shared nav bar with Explore/Play/Discover/Similarity/About links.
│   │                       Inline tabs on desktop; hamburger menu below 640px.
│   ├── SearchBar.tsx     — Search input, expand, reset, settings. Responsive layout.
│   ├── GraphView.tsx     — Force-directed 2D graph canvas (solid=expanded, outline=unexpanded).
│   ├── InfoPanel.tsx     — Side panel (desktop) / bottom sheet (mobile) for node details.
│   ├── SpotifyImportButton.tsx — "Add my Spotify top artists" button for artist-list pages.
│   │                       Hidden when no Spotify client ID is configured.
│   ├── Settings.tsx      — API key, Setlist.fm toggle, debug toggle, clear all data. Bottom sheet on mobile.
│   └── DebugConsole.tsx  — Collapsible log console.
├── api/
│   ├── supabase.ts       — Client for Supabase edge functions (venue search, aggregation).
│   ├── spotify.ts        — Spotify PKCE sign-in, token storage/refresh, top-artists fetch.
│   │                       handleSpotifyRedirect() runs in main.tsx before the router.
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
│   ├── similarity.test.ts / concerts.test.ts — Scoring and concert-ranking logic.
│   ├── tieredGraphAccess.test.ts — Tier fallback order, caching, miss recording.
│   ├── searchResolution.test.ts  — MBID-vs-name search resolution.
│   └── fixtures/         — Captured MusicBrainz API responses (search-fuzz, artist-arctic-monkeys, etc.).
├── App.tsx               — Router (HashRouter, 5 routes: Explore, Play, Discover, Similarity, About).
├── main.tsx              — Entry point.
├── vite-env.d.ts         — Vite type declarations.
├── sql.js.d.ts           — sql.js type declarations.
└── index.css             — Dark theme, mobile styles (max-width: 640px block), highlight animation.

scripts/
├── process_mb_dump.py    — Downloads MusicBrainz dump, builds browser SQLite graph.
│                           Emits person/group nodes + band edges + collapsed "collaborator"
│                           edges (album nodes removed; see collapse_credits_to_collaborator_edges).
├── seed_supabase.py      — Seeds Supabase Postgres with MusicBrainz data (BFS-filtered).
├── crawl_setlistfm.py    — Daily crawl job for Setlist.fm venue data.
└── README.md             — Script documentation.

supabase/
├── functions/
│   ├── venue-search/     — Edge function: on-demand venue lookup (artist + city → venues).
│   │                       Resolves via DB then MusicBrainz. Caches, detects toured_with.
│   ├── report-miss/      — Edge function: logs artists missing from browser SQLite.
│   └── graph-neighbors/  — Edge function (Tier 2): artist + 1-hop neighbors from Postgres.
│                           Logs misses to search_misses (graph-neighbors-not-found).
├── migrations/
│   ├── 001_schema.sql    — PostgreSQL schema (artists, albums, venues, relationships).
│   ├── 002_crawl_log.sql — Data freshness tracking.
│   └── 003_search_misses.sql — Unknown artist query logging.
├── config.toml           — Supabase project config.
└── README.md             — Deployment instructions.

docs/
├── CDN_HOSTING.md        — Hosting graph.db.gz on Cloudflare R2; Cloudflare deploy setup.
└── SPACE_SAVING.md       — Ideas for reducing database storage if needed.

public/
├── graph.db.gz           — Precomputed SQLite graph (committed, ~38MB).
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
    type TEXT NOT NULL      -- "person", "group", "album"
);

CREATE TABLE edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    rel_type TEXT NOT NULL  -- "member_of", "former_member_of", "support_musician", "collaborator"
);

-- Indexes: edges(source), edges(target), edges(rel_type), nodes(name COLLATE NOCASE), nodes(type)
--
-- NOTE (Option 4 core-shrink): the pipeline (process_mb_dump.py) now emits a
-- SMALLER core graph — person/group nodes only (NO album nodes), with album
-- co-credits collapsed into direct person<->person "collaborator" edges. The
-- older album-node schema (type "album"; rel_types producer/vocal/instrument/
-- mix/engineer/recording/album_by) is still what the CURRENTLY COMMITTED
-- graph.db.gz contains; the collaborator schema takes effect on the next regen.
-- The app handles both (album nodes are simply absent after regen).
```

## Key design decisions

- **SQLite in browser**: Precomputed graph loaded via sql.js WASM. ~38MB download (gzipped), instant queries.
- **Gzip auto-detection**: Checks first 2 bytes for gzip magic number (1f 8b). Decompresses manually if browser didn't (GitHub Pages). Skips if Vite already decompressed (Content-Encoding: gzip).
- **Game restricted to band relationships**: BFS and valid moves only use member_of, former_member_of, support_musician. Album credits stored but not used in gameplay (too complex for players).
- **Compilation filter (runtime)**: Album nodes with >25 connections skipped during BFS.
- **Membership deduplication**: For same (person, band) pair, if ANY relationship is not ended → stored as member_of (not former). Prevents Dave Grohl showing as "former member" of Foo Fighters.
- **Explore only shows artists**: Album nodes filtered from search results and neighbor expansion.
- **Concert recommendations (Pollstar, client-side)**: Discover's Concerts toggle fetches upcoming events live in the browser (kept fresh, 24h localStorage cache) rather than via a backend — so results are always current and there's no scrape job to maintain. Pollstar requests are paced ~1 req/sec (first fires immediately) with a realistic UA; CORS handled by Vite dev proxy / corsproxy.io in prod (same pattern as setlistfm). Concerts are ranked by headline-artist similarity reusing `similarity.ts` via a shared `graphAccess.ts` adapter. Artists absent from the graph score 0 and rank last (shown, flagged) — hit rate is a known future improvement (more graph artists / backend fallback). Ranking logic (`concerts.ts`) is pure and unit-tested; only the fetch layer touches the network.
- **Tiered graph coverage (Option 4)**: `src/pages/tieredGraphAccess.ts` wraps the core sql.js `GraphAccess` and, for artists NOT in the core graph, falls back through Tier 2 (Postgres `graph-neighbors` edge function) → Tier 3 (MusicBrainz live). (Discogs is a planned Tier 4, deferred.) Because the scorer's `GraphAccess` is synchronous but Tier 2/3 are async, it works in two phases: `prepareArtists(names)` (async prefetch of out-of-core artists → node + 1-hop neighbors, cached 24h, concurrent dupes deduped/shared) then `build()` returns a sync facade (core first, then overlay). Similarity and Concerts call `prepareArtists` before scoring, so out-of-core artists (esp. small concert headliners) now resolve instead of scoring 0. Tier 2 returns 1 hop only — reduced multi-hop accuracy for out-of-core artists is an accepted tradeoff. NOTE: Postgres is currently seeded with the SAME BFS-filtered universe as SQLite (`seed_supabase.py`), so Tier 3 (MusicBrainz) does the real coverage lifting until Postgres is re-seeded larger.
- **Core-graph shrink (Option 4 pipeline)**: `process_mb_dump.py` no longer emits album nodes. Album co-credits are collapsed into undirected `person —collaborator→ person` edges (`collapse_credits_to_collaborator_edges`), removing high-degree album nodes (the runtime compilation filter becomes a no-op) and shrinking the download. `collaborator` has a placeholder weight (0.5) in `similarity.ts`. Requires a regen to take effect; the committed graph.db.gz still uses the album-node schema.
- **Game valid moves**: Scrollable list of all valid connections from current node. Sorted by relationship priority (members → former → support). Filter by typing. No revisiting. Undo support.
- **Par scoring**: Par = shortest path node count. Re-rolls if < 3 hops.
- **Seed artists**: ~145 recognizable names (persons + iconic bands). BFS at 6 hops builds the graph.
- **Same-type pairs**: Game always pairs person↔person or group↔group.
- **Vite base (host-aware)**: `vite.config.ts` sets `base` by precedence: explicit `DEPLOY_BASE` env var → Cloudflare build (`WORKERS_CI` from Workers Builds, or `CF_PAGES` from Pages) → `/` → GitHub Pages production default `/MusicSceneMap/` → dev `/`. Cloudflare serves at the domain root, so the GitHub Pages base there causes a blank page (404'd assets) — hence the auto-detection. It also inlines the R2 graph URL on Cloudflare builds (see `__GRAPH_DB_CDN_URL__`), since static-assets-only Workers can't hold env vars.
- **graph.db.gz loader (local-first, CDN fallback)**: `graphDb.ts` tries the same-origin committed file first, then falls back to the CDN URL (`VITE_GRAPH_DB_URL` or the build-time `__GRAPH_DB_CDN_URL__`) if the local file is missing/HTML-fallback. On Cloudflare the local file is excluded from upload via `public/.assetsignore` (25 MiB asset cap), so it loads from R2.
- **graph.db.gz committed to repo**: Deployed with the site, same origin = no CORS. Fits GitHub's 100MB file limit. **Cloudflare Pages caps static assets at 25 MiB**, below the file size — to deploy there, host `graph.db.gz` on a CDN and set `VITE_GRAPH_DB_URL` (see `docs/CDN_HOSTING.md`). `graphDb.ts` uses `VITE_GRAPH_DB_URL || same-origin file`. **GitHub Releases was tried and rejected**: release-asset URLs 302-redirect to `objects.githubusercontent.com` without reliable `Access-Control-Allow-Origin`, so cross-origin `fetch` fails CORS. Use Cloudflare R2 (free egress, controllable CORS policy, serves raw gzip bytes so the magic-number decompression path still works) or jsDelivr.
- **Mostly client-side**: The site is static (GitHub Pages / Cloudflare) and graph queries run in the browser. Network calls are limited to Supabase edge functions (venue search, Tier-2 graph lookups, miss reporting), MusicBrainz (Tier-3 fallback), Pollstar (concerts) and Spotify (optional top-artist import).
- **Spotify import (PKCE, client-side)**: Authorization Code + PKCE needs no client secret, so it fits the static site; the client ID is public and inlined at build (`__SPOTIFY_CLIENT_ID__` in `vite.config.ts`, overridable with `VITE_SPOTIFY_CLIENT_ID`). Sign-in is a full-page redirect (more reliable on phones than a popup), so the button saves the current list and route before leaving and restores both on return. Only the read-only `user-top-read` scope is requested. Tokens live in localStorage and are refreshed with the refresh token; any other in-progress form input (e.g. Discover's city) is not preserved across the first sign-in.
- **Game persistence**: 24h in localStorage. New Game clears and regenerates.
- **Responsive**: Phone layouts come from one `@media (max-width: 640px)` block in `index.css` that targets class hooks on components (inline styles stay the desktop default). Below 640px: hamburger nav, one-row Explore toolbar, bottom-sheet InfoPanel and Settings, 44px tap targets, safe-area insets. Tested at 320px and 390px with no horizontal scroll.

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
npm run upload-graph   # upload public/graph.db.gz to R2 (wrangler, --remote)
npm run regen-graph    # regenerate then upload in one step
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

`src/test/tieredGraphAccess.test.ts` covers the tiered fallback (core → Postgres → MusicBrainz), Tier-2 caching, per-session dedupe, and miss recording. `src/test/searchResolution.test.ts` covers Explore's MBID-vs-name search resolution.

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
- `graph-neighbors` — Tier-2 graph lookup: artist + 1-hop neighbors from Postgres for artists missing from the browser SQLite.

**Search miss tracking**:
- `sqlite-missing` — in Supabase DB but not browser SQLite (frontend reports via report-miss)
- `venue-search-missing-artist` — resolved via MusicBrainz, added to Supabase (edge function logs)
- `venue-search-not-found` — not found anywhere, likely mistype (edge function logs)

**Current size**: ~320MB (artists + albums + relationships). ~180MB headroom for venues.

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
