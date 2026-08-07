# Scripts

## process_mb_dump.py

Downloads and processes the MusicBrainz full data dump into a SQLite database for the Six Degrees game.

### Prerequisites

- Python 3.9+
- ~10GB free disk space
- `zstd` command-line tool (for decompression): `brew install zstd`

### Usage

```bash
python3 scripts/process_mb_dump.py
```

### What it does

1. Finds the latest MusicBrainz full export URL
2. Downloads `mbdump.tar.zst` (~4GB) — skips if already downloaded
3. Extracts only 4 tables: `artist`, `l_artist_artist`, `link`, `link_type` — skips already-extracted tables
4. Filters to artists with ≥2 relationships (member_of, supporting_musician)
5. Outputs `public/graph.db` (SQLite) + `public/graph.db.gz` (compressed for serving)

### Output schema

```sql
CREATE TABLE artists (
    mbid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL  -- "person" or "group"
);

CREATE TABLE edges (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    rel_type TEXT NOT NULL  -- "member_of" or "support_musician"
);

CREATE INDEX idx_edges_source ON edges(source);
CREATE INDEX idx_edges_target ON edges(target);
CREATE INDEX idx_artists_name ON artists(name COLLATE NOCASE);
```

### Estimated output size

- ~50–100K artists with ≥2 relationships
- ~10–15MB SQLite file (3–5MB gzipped)

### Browser usage

The SQLite file is served from the `public/` directory and queried in the browser using [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WASM). Queries are indexed and return in ~1ms.

### Re-running

The script is idempotent:
- If dump tables are already extracted → skips download
- If tar is downloaded but not decompressed → decompresses only
- If some tables are missing → extracts only those

Delete `scripts/data/` to force a completely fresh download.

### Adding more relationship types

Edit `RELEVANT_RELATIONSHIP_TYPES` in the script to include additional types like `"producer"`, `"vocal"`, `"instrument"`. This requires also downloading `l_artist_recording` (add to `tables_needed` and write a new parser).

### Data freshness

MusicBrainz publishes new dumps twice a week. Re-run the script to update.
