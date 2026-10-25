-- Migration 008: row-level security on every table
--
-- Supabase's API (PostgREST) lets the `anon` and `authenticated` roles reach
-- every table in `public`, and those roles had full read/write/delete grants
-- with row-level security (RLS) off: anyone holding the project's anon key could
-- read, change or delete the data. The app never sends that key (the browser
-- only calls the edge functions), but the key isn't a secret by design.
--
-- With RLS on and no policy for them, anon and authenticated see no rows and
-- can't write. Nothing the app uses changes:
--   - edge functions use the service role, which bypasses RLS
--   - seed_supabase.py and crawl_setlistfm.py connect as the table owner
--     (postgres), which RLS doesn't apply to
--   - concertdb_misses (migration 007) keeps reading search_misses through the
--     policy below
-- TRUNCATE ignores RLS, so it is revoked from anon and authenticated too.
--
-- A new table needs the same: ALTER TABLE ... ENABLE ROW LEVEL SECURITY.

ALTER TABLE public.artists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genres        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_misses ENABLE ROW LEVEL SECURITY;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

DROP POLICY IF EXISTS concertdb_misses_read ON public.search_misses;
CREATE POLICY concertdb_misses_read ON public.search_misses
    FOR SELECT TO concertdb_misses USING (true);
