# Supabase Edge Functions

## venue-search

On-demand venue lookup for an artist in a city. Caches results in Supabase.

### Endpoint

```
GET https://lwqkjtzqjgacgvfjiyxg.supabase.co/functions/v1/venue-search
```

### Parameters

| Param | Required | Description |
|---|---|---|
| `city` | Yes | City name (e.g. "Los Angeles") |
| `artist` | One of these | Artist name (looked up in DB) |
| `artistMbid` | One of these | MusicBrainz ID directly |

### Example

```
/venue-search?artist=Ty+Segall&city=Los+Angeles
```

### Response

```json
{
  "source": "cache" | "api",
  "artist": "mbid",
  "city": "Los Angeles",
  "venues": [
    { "venue": "Zebulon", "city": "Los Angeles", "country": "United States", "showCount": 12 },
    { "venue": "Lodge Room", "city": "Los Angeles", "country": "United States", "showCount": 5 }
  ]
}
```

### Deployment

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Login
supabase login

# Set the API key secret
supabase secrets set SETLISTFM_API_KEY=hF7i_y1dRFcZVU95gt6YIe5VVQgBrDG6m8J1 --project-ref lwqkjtzqjgacgvfjiyxg

# Deploy (--no-verify-jwt makes it publicly callable without auth)
supabase functions deploy venue-search --no-verify-jwt --project-ref lwqkjtzqjgacgvfjiyxg
```

### How it works

1. Checks Supabase for cached `played_at` relationships for this artist + city
2. If found → returns cached data (instant)
3. If miss → calls Setlist.fm API with `cityName` filter → stores results → returns
4. Future calls for the same artist+city hit the cache
