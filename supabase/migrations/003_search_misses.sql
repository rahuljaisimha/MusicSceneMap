-- Migration 003: Track artist search misses
--
-- When a user searches for an artist we don't have in our database,
-- record it so we can prioritize expanding the dataset.

CREATE TABLE IF NOT EXISTS search_misses (
    id SERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'venue-search',  -- which feature triggered it
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_misses_query ON search_misses(query);
