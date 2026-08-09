# Supabase Edge Functions

## venue-search

On-demand venue lookup for an artist in a city. Resolves artists, fetches from Setlist.fm, caches results, detects touring partners.

### Endpoint

```
GET https://lwqkjtzqjgacgvfjiyxg.supabase.co/functions/v1/venue-search
```

### Parameters

| Param | Required | Description |
|---|---|---|
| `city` | Yes | City name (e.g. "Los Angeles") |
| `artist` | One of these | Artist name (resolved against DB, then MusicBrainz) |
| `artistMbid` | One of these | MusicBrainz ID directly (avoids name ambiguity) |

### Example

```
/venue-search?artist=Ty+Segall&city=Los+Angeles
/venue-search?artistMbid=07a17571-81fc-4cf8-a634-98f0d926d313&city=Austin
```

### Response

```json
{
  "source": "cache" | "api",
  "stale": false,
  "artist": "mbid",
  "city": "Los Angeles",
  "venues": [
    { "venue": "Zebulon", "city": "Los Angeles", "country": "United States", "showCount": 12 },
    { "venue": "Lodge Room", "city": "Los Angeles", "country": "United States", "showCount": 5 }
  ]
}
```

### How it works

1. **Resolve artist**: check our DB by name → if not found, try MusicBrainz API → if found, add to our DB + log miss
2. **Check cache**: look in `crawl_log` for this artist+city. If <14 days old, return cached data.
3. **If stale or miss**: call Setlist.fm API with `cityName` filter → store venues + `played_at` relationships
4. **Detect touring partners**: check venue setlists for other artists on the same date → store `toured_with` relationships
5. **Update crawl_log** timestamp

### Artist resolution fallback

| Scenario | Action |
|---|---|
| Found in our `artists` table | Use directly |
| Not in DB, MusicBrainz resolves it | Add to `artists` table, log to `search_misses` (source: `venue-search-missing-artist`) |
| Not found anywhere (likely mistype) | Log to `search_misses` (source: `venue-search-not-found`), return 404 |

---

## report-miss

Lightweight endpoint for the frontend to report artists missing from the browser SQLite.

### Endpoint

```
POST https://lwqkjtzqjgacgvfjiyxg.supabase.co/functions/v1/report-miss
```

### Body

```json
{ "query": "Frankie and the Witch Fingers", "source": "sqlite-missing" }
```

### Sources

| source | Meaning | Action needed |
|---|---|---|
| `sqlite-missing` | Artist exists in Supabase but not in browser SQLite | Regenerate SQLite |
| `venue-search-missing-artist` | Not in DB, resolved via MusicBrainz, added to Supabase | Will be in SQLite on next regen |
| `venue-search-not-found` | Not found anywhere (mistype) | No action |

### Querying misses

```sql
SELECT query, source, COUNT(*) as times
FROM search_misses
WHERE source IN ('sqlite-missing', 'venue-search-missing-artist')
GROUP BY query, source
ORDER BY times DESC;
```

---

## Deployment

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Login
supabase login

# Set secrets
supabase secrets set SETLISTFM_API_KEY=your-key --project-ref lwqkjtzqjgacgvfjiyxg

# Deploy all functions
supabase functions deploy venue-search --no-verify-jwt --project-ref lwqkjtzqjgacgvfjiyxg
supabase functions deploy report-miss --no-verify-jwt --project-ref lwqkjtzqjgacgvfjiyxg
```

## Migrations

Run in the Supabase SQL Editor (Dashboard → SQL Editor):

1. `migrations/001_schema.sql` — artists, albums, venues, relationships tables
2. `migrations/002_crawl_log.sql` — crawl freshness tracking
3. `migrations/003_search_misses.sql` — logging unknown artist queries
