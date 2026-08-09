-- Migration 002: Crawl log for tracking data freshness
--
-- Tracks when we last fetched venue data for an artist+city combination.
-- Used for stale-while-revalidate: return cached data immediately,
-- re-fetch in background if older than 14 days.

CREATE TABLE IF NOT EXISTS crawl_log (
    id SERIAL PRIMARY KEY,
    artist_mbid TEXT NOT NULL,
    city TEXT NOT NULL,
    last_fetched TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(artist_mbid, city)
);

CREATE INDEX IF NOT EXISTS idx_crawl_log_lookup ON crawl_log(artist_mbid, city);
