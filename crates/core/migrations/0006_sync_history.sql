-- One row per sync attempt. `bulk_sync` holds the last one only, which is why
-- every bound a sync refuses on rests on a single observation.
--
-- Written outside the sync's transaction, so a refusal leaves a row rather
-- than rolling away with the catalog it declined to replace.
CREATE TABLE sync_history (
    id         INTEGER NOT NULL PRIMARY KEY,
    kind       TEXT    NOT NULL,
    -- The bulk file's own updated_at. Repeated rows under one version are a
    -- refusal being retried, each having cost the download again.
    updated_at TEXT    NOT NULL,
    -- 'synced', or which guard refused: empty, skipped, shrunk, shape, error.
    outcome    TEXT    NOT NULL,
    written    INTEGER NOT NULL,
    cards      INTEGER NOT NULL,
    skipped    INTEGER NOT NULL,
    -- Printings the cache held going in, which is what `written` is weighed
    -- against. Null on a first sync into an empty cache.
    held       INTEGER,
    at         TEXT    NOT NULL DEFAULT (datetime('now'))
) STRICT;
