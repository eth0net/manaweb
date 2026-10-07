-- A printing folded back on itself no longer leads its card's run.
--
-- The version is what delivers that: a cache synced under an earlier schema
-- re-syncs before it exports, which is the only thing that can move a
-- representative printing, since the order that picks one is in Rust. The
-- statements below leave a cache consistent in the meantime, and are the one
-- written form of the clause that a test holds `catalog::ORDER` to.

WITH ordered AS (
    SELECT c.id AS id, row_number() OVER (
        ORDER BY o.name, o.id,
                 CASE WHEN c.set_type IN ('expansion', 'core') THEN 0 ELSE 1 END,
                 c.booster DESC,
                 c.layout = 'reversible_card',
                 c.released_at DESC,
                 NOT EXISTS (SELECT 1 FROM json_each(c.finishes)
                             WHERE value = 'nonfoil'),
                 c.collector_number, c.id
    ) AS n
    FROM cards c JOIN oracle o ON o.id = c.oracle_id
    WHERE NOT c.digital
)
UPDATE cards SET seq = ordered.n FROM ordered WHERE ordered.id = cards.id;

-- Read back off `seq` rather than ordered again, so the two cannot disagree.
UPDATE oracle SET default_print = (
    SELECT c.id FROM cards c
    WHERE c.oracle_id = oracle.id AND c.seq IS NOT NULL
    ORDER BY c.seq LIMIT 1
) WHERE paper;
