# Scripts

Local scripts for data processing and database management.

## process_mb_dump.py

Downloads the MusicBrainz data dump and builds the browser SQLite database (`public/graph.db.gz`).

```bash
brew install zstd
python3 scripts/process_mb_dump.py                       # then add_concertdb_edges.py
python3 scripts/process_mb_dump.py --concertdb-hops 2    # fewer hops around concert-database's artists
```

Artists: within 6 hops of the curated seeds (the game's list in
`src/game/artists.ts`, by MusicBrainz ID), and within `--concertdb-hops`
(`CONCERTDB_HOPS`, default 6) of each artist with a concert in the
concert-database ledger (`CONCERTDB_LEDGER`, default
`~/concert-database/data/ledger.sqlite`; without it, curated seeds only), over
band relationships. If `graph.db.gz` is over `--max-gzip-mb` (74), it is
rebuilt with one hop fewer around concert-database's artists until it fits.

Edges: band relationships, and `produced_for` / `collaborated_with` from an
artist to the artists whose records they produced or sang/played/performed on
(not between a band and its members: the membership edge covers that).

## add_concertdb_edges.py

Adds "opened for" edges (opener → headliner, `rel_type = 'opened_for'`) to
`public/graph.db.gz` from a local concert-database ledger, read-only. Pairs are
those `concertdb export --musicbrainz-only` exports (both acts matched to
MusicBrainz, no festivals or cancelled shows, confidence ≥ 0.4). Acts that
aren't in the graph are added as nodes. Re-running replaces the previous
`opened_for` edges, so it can refresh them without rebuilding the graph.

```bash
python3 scripts/process_mb_dump.py        # rebuilds the graph (no opened_for edges)
python3 scripts/add_concertdb_edges.py    # then add them
python3 scripts/add_concertdb_edges.py --ledger ~/concert-database/data/ledger.sqlite --min-conf 0.4
```

## seed_supabase.py

Seeds the Supabase PostgreSQL database with the same artists and edges as the
browser graph, never cut down for size, with the song-credit count on each
collaboration. Run `supabase/migrations/005_collaborations.sql` first if the
database still has the album table.

```bash
pip install psycopg2-binary
python3 scripts/seed_supabase.py --dry-run     # count rows, write nothing
export SUPABASE_DB_URL='postgresql://...'
python3 scripts/seed_supabase.py
```

Requires dump tables to already be extracted (run `process_mb_dump.py` first to download).

## crawl_setlistfm.py

Fetches setlist/venue data from the Setlist.fm API for artists in the database.
Designed to run periodically (daily), respects API rate limits.

```bash
pip install psycopg2-binary requests
export SUPABASE_DB_URL='postgresql://...'
export SETLISTFM_API_KEY='your-key'
python3 scripts/crawl_setlistfm.py --limit 50 --pages 3
```

Options:
- `--limit N` — max artists to crawl this run (default: 100)
- `--pages N` — max pages per artist (default: 3)
