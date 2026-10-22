-- Migration 004: artist search for the app's artist dropdowns
--
-- graph-neighbors' search mode (?q=) matches names with ILIKE '%q%'; a
-- trigram index keeps that fast without a sequential scan. `area` (the artist's begin area, usually a
-- city, else its area) labels same-name artists; seed_supabase.py fills it.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON artists USING gin (name gin_trgm_ops);

ALTER TABLE artists ADD COLUMN IF NOT EXISTS area TEXT;
