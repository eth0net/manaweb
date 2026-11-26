-- What a booster draws from, out of MTGJSON's four setBooster* tables. Like
-- the card cache this is disposable: re-running the sync rebuilds it.
--
-- A configuration is a set's — `blb`'s play booster is numbered apart from
-- `mh3`'s — so every key here carries both halves. See `docs/products.md`.

-- One sheet of one configuration, which is the pool a slot draws from.
CREATE TABLE booster_sheets (
    id       INTEGER NOT NULL PRIMARY KEY,
    set_code TEXT    NOT NULL,
    -- As the set's own `booster` object keys it: play, collector, draft.
    booster  TEXT    NOT NULL,
    name     TEXT    NOT NULL,
    foil     INTEGER NOT NULL,
    -- Drawn to even out colors, which makes a card's weight an approximation
    -- rather than the whole story.
    balanced INTEGER NOT NULL,
    -- The denominator a card's weight sits over. Given rather than summed, so
    -- it still divides where a card was dropped for not being paper.
    weight   INTEGER NOT NULL,
    UNIQUE (set_code, booster, name)
) STRICT;

-- How often each variant is the one in the wrapper, out of its own
-- configuration's total rather than out of anything fixed.
CREATE TABLE booster_variants (
    set_code TEXT    NOT NULL,
    booster  TEXT    NOT NULL,
    variant  INTEGER NOT NULL,
    weight   INTEGER NOT NULL,
    PRIMARY KEY (set_code, booster, variant)
) STRICT;

-- What one variant takes from one sheet. A sheet missing from a variant has
-- no row here and is read as none of it, which is where a range like 3-4 C
-- comes from.
CREATE TABLE booster_slots (
    sheet_id INTEGER NOT NULL REFERENCES booster_sheets (id) ON DELETE CASCADE,
    variant  INTEGER NOT NULL,
    picks    INTEGER NOT NULL,
    PRIMARY KEY (sheet_id, variant)
) STRICT;

-- Every card on every sheet, keyed by printing rather than by MTGJSON's uuid:
-- the identifier table is read during the sync and never kept, a uuid naming
-- a part where a sheet names the whole card.
--
-- A row whose printing the cache has no paper copy of is dropped on the way
-- in, which is how a digital booster comes to hold nothing.
CREATE TABLE booster_pool (
    sheet_id    INTEGER NOT NULL REFERENCES booster_sheets (id) ON DELETE CASCADE,
    scryfall_id TEXT    NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    weight      INTEGER NOT NULL,
    PRIMARY KEY (sheet_id, scryfall_id)
) STRICT;

-- Answers the card's own direction: which sheets, and so which products, a
-- printing can come out of.
CREATE INDEX booster_pool_card ON booster_pool (scryfall_id);
