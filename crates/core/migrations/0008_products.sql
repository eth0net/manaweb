-- What a sealed product holds, out of MTGJSON's `sealedProducts` and
-- `setDecks`. Disposable like the card cache: the sync rebuilds all of it.
--
-- Set codes are spelled as the card cache spells them, MTGJSON writing them
-- two ways. See `docs/products.md`.

-- One product: a pack, a box, a precon, a bundle. Keyed by MTGJSON's uuid,
-- there being no other id for a thing Scryfall does not describe.
CREATE TABLE products (
    uuid         TEXT    NOT NULL PRIMARY KEY,
    set_code     TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    -- `booster_box`, `deck`, `bundle` and a dozen more. A string for the same
    -- reason Scryfall's taxonomies are.
    category     TEXT,
    subtype      TEXT,
    release_date TEXT,
    -- What MTGJSON believes is in it, which for a booster is the pack size
    -- rather than anything the contents below add up to.
    card_count   INTEGER,
    -- How many of the thing the name describes: 36 packs, 6 boxes.
    size         INTEGER
) STRICT;

CREATE INDEX products_set ON products (set_code);

-- One decklist, as a precon ships it. `code` repeats, across sets and within
-- one, so the name carries the key — which is also how a product names it.
CREATE TABLE decks (
    id           INTEGER NOT NULL PRIMARY KEY,
    set_code     TEXT    NOT NULL,
    code         TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    release_date TEXT,
    UNIQUE (set_code, name)
) STRICT;

-- Every card on every board, keyed by printing rather than by uuid as the
-- booster pool is. A board naming one twice arrives as a single row.
CREATE TABLE deck_cards (
    deck_id     INTEGER NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    -- `mainBoard` and the six others, as MTGJSON names them.
    board       TEXT    NOT NULL,
    scryfall_id TEXT    NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    -- One of nonfoil, foil, etched. Read from both flags, never from the foil
    -- one alone, an etched printing setting it too.
    finish      TEXT    NOT NULL,
    count       INTEGER NOT NULL,
    PRIMARY KEY (deck_id, board, scryfall_id, finish)
) STRICT;

CREATE INDEX deck_cards_card ON deck_cards (scryfall_id);

-- One way a product is packed. Every product has a root whose parent is
-- nothing; one packed several ways has a child per config, and a config can
-- branch again. Siblings are equally likely, so none of them carries a weight.
CREATE TABLE product_configs (
    id        INTEGER NOT NULL PRIMARY KEY,
    product   TEXT    NOT NULL REFERENCES products (uuid) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES product_configs (id) ON DELETE CASCADE,
    position  INTEGER NOT NULL
) STRICT;

CREATE INDEX product_configs_product ON product_configs (product);

-- What a config holds is five tables rather than one keyed by a kind: every
-- column is filled and every reference is a real one. `position` runs across
-- all five, so reading them together gives one order.

CREATE TABLE product_cards (
    config_id   INTEGER NOT NULL REFERENCES product_configs (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    scryfall_id TEXT    NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    finish      TEXT    NOT NULL,
    PRIMARY KEY (config_id, position)
) STRICT;

CREATE INDEX product_cards_card ON product_cards (scryfall_id);

CREATE TABLE product_decks (
    config_id INTEGER NOT NULL REFERENCES product_configs (id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    deck_id   INTEGER NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    PRIMARY KEY (config_id, position)
) STRICT;

CREATE INDEX product_decks_deck ON product_decks (deck_id);

-- A count of another product, which is where a box becomes its packs.
CREATE TABLE product_sealed (
    config_id INTEGER NOT NULL REFERENCES product_configs (id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    holds     TEXT    NOT NULL REFERENCES products (uuid) ON DELETE CASCADE,
    count     INTEGER NOT NULL,
    PRIMARY KEY (config_id, position)
) STRICT;

CREATE INDEX product_sealed_holds ON product_sealed (holds);

-- A booster configuration, named rather than referenced: a few name one the
-- booster tables do not carry, and what is on the wrapper is worth saying
-- even where nothing says what the wrapper draws from.
CREATE TABLE product_packs (
    config_id INTEGER NOT NULL REFERENCES product_configs (id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    set_code  TEXT    NOT NULL,
    booster   TEXT    NOT NULL,
    PRIMARY KEY (config_id, position)
) STRICT;

CREATE INDEX product_packs_booster ON product_packs (set_code, booster);

-- Spindowns, storage, life trackers: a name, and nothing to resolve it to.
CREATE TABLE product_other (
    config_id INTEGER NOT NULL REFERENCES product_configs (id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    name      TEXT    NOT NULL,
    PRIMARY KEY (config_id, position)
) STRICT;
