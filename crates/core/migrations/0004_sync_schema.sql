-- Which schema the cache was built under, checked against the migrator's
-- latest before anything reads the cache — see `docs/scryfall.md`.
--
-- Null on a cache synced before this column, so it re-syncs once.
ALTER TABLE bulk_sync ADD COLUMN schema_version INTEGER;
