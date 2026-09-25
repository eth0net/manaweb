-- Which artwork a printing carries. Printings sharing one are what an art
-- match narrows to, and picking among those is the scanner — see
-- `docs/scanner.md`.
--
-- Null until the next sync: it comes from Scryfall and no row here derives it.
ALTER TABLE cards ADD COLUMN illustration_id TEXT;
