-- Where a printing sits in the client artifact, written at sync. The export
-- sorted for it instead, which carried every column of a hundred thousand
-- rows through a temp B-tree and was most of what the export cost.
--
-- Null where a printing is never exported, so the index carries only what is.
ALTER TABLE cards ADD COLUMN seq INTEGER;

CREATE INDEX cards_export ON cards (seq) WHERE seq IS NOT NULL;

-- A cache already synced keeps its rows, so the order is filled in here. The
-- clause is the one in `catalog::ORDER`, held to it by a test.
WITH ordered AS (
    SELECT c.id AS id, row_number() OVER (
        ORDER BY o.name, o.id,
                 CASE WHEN c.set_type IN ('expansion', 'core') THEN 0 ELSE 1 END,
                 c.booster DESC, c.released_at DESC,
                 instr(c.finishes, 'nonfoil') = 0,
                 c.collector_number, c.id
    ) AS n
    FROM cards c JOIN oracle o ON o.id = c.oracle_id
    WHERE NOT c.digital
)
UPDATE cards SET seq = ordered.n FROM ordered WHERE ordered.id = cards.id;
