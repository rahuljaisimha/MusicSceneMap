# Space-Saving Ideas for Database

If the Supabase free tier (500MB) is exceeded, these options can reduce storage without losing functionality:

## 1. Flatten album credits to artist→artist (saves ~200-250MB)

Remove the `albums` table entirely. Instead of:
```
Josh Homme → Humbug (instrument, 5)
Josh Homme → Tranquility Base (instrument, 2)
Humbug → Arctic Monkeys (primary_artist)
```

Store:
```
Josh Homme → Arctic Monkeys (instrument, count: 7)
```

Loses album-level detail but preserves the connection and total frequency. Album specifics can be looked up from MusicBrainz at runtime if needed.

## 2. Trim unconnected artists

Remove artists who:
- Have zero relationships
- Are only connected to one other entity
- Have never been queried by any user

Could be done periodically as a cleanup job.

## 3. Cap album credits per artist

Instead of storing all 736 album credits for a session musician like Ron Carter, keep only the top 20 (by track count). Preserves the strongest connections, drops the noise.

## 4. Drop technical credits (mix, engineer, recording)

Only keep `producer`, `vocal`, `instrument`. The technical roles (mix, engineer, recording) are weak signals for scene connection and account for ~30% of album credit rows.

## 5. Integer IDs for relationships

Replace 36-char UUID text in `source_id`/`target_id` with integer foreign keys. Each relationship row shrinks from ~100 bytes to ~30 bytes. Requires adding surrogate integer PKs to entity tables.

## 6. Deduplicate similar relationships

If an artist has both `vocal` and `instrument` credits on the same album, collapse to a single `contributor` type. Fewer rows, less granularity.

## 7. Partition by popularity

Store top 100K most-connected artists in Supabase (hot data). Keep the full dataset in a cold store (S3 + SQLite file) for rare queries.

## 8. Drop idx_rels_unique after seeding (saves ~100MB)

The unique constraint index on `(source_id, target_id, rel_type)` is only needed during import to prevent duplicates. After seeding is complete, drop it to reclaim ~100MB. Re-create before any future re-seed.

```sql
DROP INDEX idx_rels_unique;
-- To recreate later:
-- CREATE UNIQUE INDEX idx_rels_unique ON relationships(source_id, target_id, rel_type);
```
