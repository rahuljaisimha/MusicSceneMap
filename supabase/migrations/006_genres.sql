-- Migration 006: genres
--
-- Each artist's MusicBrainz genres (see pick_genres in scripts/process_mb_dump.py):
-- genres with 2+ votes, most voted first, the top 3 plus any tied with the third.
-- Stored as ids into a small `genres` table rather than as text on every artist:
-- about 1,200 genres are in use, and an id list is the smallest form (a separate
-- artist_genres table would repeat the 36-character artist id on every row).
--
-- A genre's id is its position in MusicBrainz's sorted genre list, so the ids can
-- change when MusicBrainz adds genres; seed_supabase.py replaces `genres` and
-- rewrites artists.genre_ids together. Run before re-seeding.

CREATE TABLE IF NOT EXISTS genres (
    id   SMALLINT PRIMARY KEY,
    name TEXT NOT NULL
);

ALTER TABLE artists ADD COLUMN IF NOT EXISTS genre_ids SMALLINT[];
