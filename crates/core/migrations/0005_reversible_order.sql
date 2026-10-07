-- A printing folded back on itself no longer leads its card's run, so the
-- order written at sync gained a clause and the rows already numbered are
-- renumbered here.
--
-- The version alone is what moves the representative printings with it: a
-- cache synced under an earlier schema is re-synced before anything exports.

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
