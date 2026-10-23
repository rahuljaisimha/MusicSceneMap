-- Migration 005: collaborations instead of albums + per-album credits
--
-- seed_supabase.py now stores a credit on another artist's record as one
-- artist -> artist relationship per role, with the number of song credits in
-- `count`:
--   produced_for       producer credits
--   collaborated_with  vocal / instrument credits
-- Engineering credits (mix, engineer, recording) are no longer kept, and
-- neither are albums. graph-neighbors never returned album neighbors (albums
-- aren't artists), so nothing reads what is removed here.
--
-- Run before re-seeding. DELETE doesn't give the disk space back by itself:
-- afterwards run, outside a transaction (SQL editor, one statement):
--   VACUUM FULL relationships;

DELETE FROM relationships
WHERE rel_type IN ('producer', 'vocal', 'instrument', 'mix', 'engineer', 'recording');

DROP TABLE IF EXISTS albums;

-- Covered by idx_rels_unique (source_id, target_id, rel_type): lookups by
-- source_id, and by source_id + rel_type, use its leading column(s).
DROP INDEX IF EXISTS idx_rels_source;
-- Every query that filters on rel_type also filters on source_id.
DROP INDEX IF EXISTS idx_rels_type;
