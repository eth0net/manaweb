//! The sealed product cache: what a pack, box or precon holds, out of MTGJSON.
//!
//! One full replace per build, resolved against the card cache as the booster
//! sync is, and running after it for the same reason. Reasoning and figures
//! are in `docs/products.md`.

use std::collections::HashMap;
use std::collections::hash_map::Entry;

use manaweb_mtgjson::{Board, Contents, Deck, Identity, Product, Rows};
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{Error, Result};

/// Rows allowed to reach nothing before the sync is refused.
const ALLOWED_MISSING: f64 = 0.01;

/// Below this many rows the share above means little, so only an empty sync
/// is refused.
const ENOUGH_READ: i64 = 1_000;

/// How much of the last product count a new one has to keep.
const LEAST_KEPT: f64 = 0.95;

/// A decklist's key, which is its name under its set: the code repeats.
type Lists = HashMap<(String, String), i64>;

/// Printing ids by MTGJSON uuid, cards and tokens in one map.
type Printings = HashMap<Uuid, Uuid>;

/// The boards MTGJSON writes, in the order a decklist reads in.
const BOARDS: [&str; 7] = [
    "mainBoard",
    "sideBoard",
    "commander",
    "displayCommander",
    "tokens",
    "planes",
    "schemes",
];

/// What one replace did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Report {
    pub products: i64,
    pub decks: i64,
    /// Cards on decklist boards, a board naming one twice counted once.
    pub deck_cards: i64,
    /// Ways a product is packed, every product having at least the one.
    pub configs: i64,
    /// What those configs hold, over all five kinds.
    pub contents: i64,
    /// Board entries folded into a row already written.
    pub merged: i64,
    /// Rows reaching no printing, decklist or product, and so left out.
    pub missing: i64,
    /// Of the list entries written, those the catalog exports no position
    /// for. No product's exact contents names one — `docs/products.md`.
    pub digital: i64,
}

/// The four tables one sync reads, opened by the caller so tests can hand it
/// fixtures and the refresh can hand it downloads.
#[derive(Debug)]
pub struct Tables {
    /// Read first and held only for the length of the sync.
    pub identities: Rows<Identity>,
    /// `tokenIdentifiers`, which a `tokens` board needs and a booster does
    /// not.
    pub tokens: Rows<Identity>,
    pub products: Rows<Product>,
    pub decks: Rows<Deck>,
}

/// Replaces the product cache from one MTGJSON build.
///
/// Refuses rather than publishes a half-filled one: the transaction rolls
/// back, leaving whatever the last good sync wrote.
///
/// # Errors
///
/// Fails on a database or stream error, and refuses a build that reads empty,
/// that names printings the cache has never held, or that holds markedly
/// fewer products than the last. A build whose boards place no card at all is
/// one run before the Scryfall sync it resolves against, and reads as empty.
pub async fn replace(pool: &SqlitePool, tables: Tables) -> Result<Report> {
    let Tables {
        mut identities,
        mut tokens,
        mut products,
        mut decks,
    } = tables;

    let printing = identify(&mut identities, &mut tokens).await?;
    let before = count(pool).await?;
    let mut tx = pool.begin().await?;
    let mut report = Report::default();

    for statement in [
        "DELETE FROM product_other",
        "DELETE FROM product_packs",
        "DELETE FROM product_sealed",
        "DELETE FROM product_decks",
        "DELETE FROM product_cards",
        "DELETE FROM product_configs",
        "DELETE FROM products",
        "DELETE FROM deck_cards",
        "DELETE FROM decks",
    ] {
        sqlx::query(statement).execute(&mut *tx).await?;
    }

    let mut read = 0i64;
    let lists = write_decks(&mut tx, &mut decks, &printing, &mut read, &mut report).await?;
    let held = write_products(&mut tx, &mut products, &mut report).await?;
    write_contents(&mut tx, &held, &lists, &mut read, &mut report).await?;

    refuse(&report, read, before)?;
    report.digital = digital(&mut tx).await?;
    tx.commit().await?;
    Ok(report)
}

/// Both identifier tables as one map, held only for the length of the sync.
async fn identify(cards: &mut Rows<Identity>, tokens: &mut Rows<Identity>) -> Result<Printings> {
    let mut printing = Printings::new();
    for rows in [cards, tokens] {
        while let Some(one) = rows.try_next().await? {
            printing.insert(one.uuid, one.scryfall_id);
        }
    }
    Ok(printing)
}

/// The decklists and their boards, answering with the keys a product's
/// contents names them by.
async fn write_decks(
    tx: &mut Transaction<'_, Sqlite>,
    rows: &mut Rows<Deck>,
    printing: &Printings,
    read: &mut i64,
    report: &mut Report,
) -> Result<Lists> {
    let mut lists = Lists::new();
    while let Some(deck) = rows.try_next().await? {
        let set_code = code(&deck.set_code);
        let id = sqlx::query(
            "INSERT INTO decks (set_code, code, name, kind, release_date)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&set_code)
        .bind(&deck.code)
        .bind(&deck.name)
        .bind(&deck.kind)
        .bind(&deck.release_date)
        .execute(&mut **tx)
        .await?
        .last_insert_rowid();
        lists.insert((set_code, deck.name.clone()), id);
        report.decks += 1;
        write_boards(tx, id, &deck, printing, read, report).await?;
    }
    Ok(lists)
}

/// One decklist's seven boards, each entry summed onto whatever the board
/// already said about that printing in that finish.
async fn write_boards(
    tx: &mut Transaction<'_, Sqlite>,
    deck_id: i64,
    deck: &Deck,
    printing: &Printings,
    read: &mut i64,
    report: &mut Report,
) -> Result<()> {
    let boards = [
        &deck.main_board,
        &deck.side_board,
        &deck.commander,
        &deck.display_commander,
        &deck.tokens,
        &deck.planes,
        &deck.schemes,
    ];
    for (board, entries) in BOARDS.iter().zip(boards) {
        let mut counted: HashMap<(Uuid, &'static str), i64> = HashMap::new();
        let mut order: Vec<(Uuid, &'static str)> = Vec::new();
        for entry in entries {
            *read += 1;
            let Some(&card) = entry.uuid.as_ref().and_then(|uuid| printing.get(uuid)) else {
                report.missing += 1;
                continue;
            };
            let key = (card, finish(entry));
            match counted.entry(key) {
                Entry::Occupied(mut held) => {
                    *held.get_mut() += i64::from(entry.count);
                    report.merged += 1;
                }
                Entry::Vacant(slot) => {
                    slot.insert(i64::from(entry.count));
                    order.push(key);
                }
            }
        }
        for key in order {
            let (card, finish) = key;
            let placed = sqlx::query(
                "INSERT INTO deck_cards (deck_id, board, scryfall_id, finish, count)
                 SELECT ?, ?, id, ?, ? FROM cards WHERE id = ?",
            )
            .bind(deck_id)
            .bind(board)
            .bind(finish)
            .bind(counted[&key])
            .bind(card.to_string())
            .execute(&mut **tx)
            .await?
            .rows_affected();
            if placed == 0 {
                report.missing += 1;
            } else {
                report.deck_cards += 1;
            }
        }
    }
    Ok(())
}

/// The products, answering with the contents each one holds: a `sealed` entry
/// names another product, so none of them can be written until all are.
async fn write_products(
    tx: &mut Transaction<'_, Sqlite>,
    rows: &mut Rows<Product>,
    report: &mut Report,
) -> Result<Vec<(Uuid, Contents)>> {
    let mut held = Vec::new();
    while let Some(product) = rows.try_next().await? {
        sqlx::query(
            "INSERT INTO products
                 (uuid, set_code, name, category, subtype, release_date, card_count, size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(product.uuid.to_string())
        .bind(code(&product.set_code))
        .bind(&product.name)
        .bind(&product.category)
        .bind(&product.subtype)
        .bind(&product.release_date)
        .bind(product.card_count)
        .bind(product.product_size)
        .execute(&mut **tx)
        .await?;
        report.products += 1;
        held.push((product.uuid, product.contents));
    }
    Ok(held)
}

/// Every product's contents, each config written before the configs it holds
/// so a child has a parent to name.
async fn write_contents(
    tx: &mut Transaction<'_, Sqlite>,
    held: &[(Uuid, Contents)],
    lists: &Lists,
    read: &mut i64,
    report: &mut Report,
) -> Result<()> {
    for (product, contents) in held {
        let mut pending: Vec<(Option<i64>, i64, &Contents)> = vec![(None, 0, contents)];
        while let Some((parent, position, contents)) = pending.pop() {
            let id = sqlx::query(
                "INSERT INTO product_configs (product, parent_id, position) VALUES (?, ?, ?)",
            )
            .bind(product.to_string())
            .bind(parent)
            .bind(position)
            .execute(&mut **tx)
            .await?
            .last_insert_rowid();
            report.configs += 1;

            let mut at = 0i64;
            write_config(tx, id, &mut at, contents, lists, read, report).await?;
            let mut branch = 0i64;
            for variable in &contents.variable {
                for config in &variable.configs {
                    pending.push((Some(id), branch, config));
                    branch += 1;
                }
            }
        }
    }
    Ok(())
}

/// One config's own entries, numbered across the five tables so that reading
/// them together gives one order.
async fn write_config(
    tx: &mut Transaction<'_, Sqlite>,
    config: i64,
    at: &mut i64,
    contents: &Contents,
    lists: &Lists,
    read: &mut i64,
    report: &mut Report,
) -> Result<()> {
    for card in &contents.card {
        *read += 1;
        let placed = sqlx::query(
            "INSERT INTO product_cards (config_id, position, scryfall_id, finish)
             SELECT ?, ?, id, ? FROM cards WHERE set_code = ? AND collector_number = ?",
        )
        .bind(config)
        .bind(*at)
        .bind(printed(card.foil, card.etched))
        .bind(code(&card.set_code))
        .bind(&card.number)
        .execute(&mut **tx)
        .await?
        .rows_affected();
        tally(placed > 0, at, report);
    }
    for deck in &contents.deck {
        *read += 1;
        let Some(&id) = lists.get(&(code(&deck.set_code), deck.name.clone())) else {
            report.missing += 1;
            continue;
        };
        sqlx::query("INSERT INTO product_decks (config_id, position, deck_id) VALUES (?, ?, ?)")
            .bind(config)
            .bind(*at)
            .bind(id)
            .execute(&mut **tx)
            .await?;
        tally(true, at, report);
    }
    for sealed in &contents.sealed {
        *read += 1;
        let placed = sqlx::query(
            "INSERT INTO product_sealed (config_id, position, holds, count)
             SELECT ?, ?, uuid, ? FROM products WHERE uuid = ?",
        )
        .bind(config)
        .bind(*at)
        .bind(i64::from(sealed.count))
        .bind(sealed.uuid.to_string())
        .execute(&mut **tx)
        .await?
        .rows_affected();
        tally(placed > 0, at, report);
    }
    for pack in &contents.pack {
        sqlx::query(
            "INSERT INTO product_packs (config_id, position, set_code, booster)
             VALUES (?, ?, ?, ?)",
        )
        .bind(config)
        .bind(*at)
        .bind(code(&pack.set_code))
        .bind(&pack.code)
        .execute(&mut **tx)
        .await?;
        tally(true, at, report);
    }
    for piece in &contents.other {
        sqlx::query("INSERT INTO product_other (config_id, position, name) VALUES (?, ?, ?)")
            .bind(config)
            .bind(*at)
            .bind(&piece.name)
            .execute(&mut **tx)
            .await?;
        tally(true, at, report);
    }
    Ok(())
}

/// One entry counted and its place kept, whether or not a row took it: the
/// position is where the entry sits, not where the row landed.
fn tally(placed: bool, at: &mut i64, report: &mut Report) {
    *at += 1;
    if placed {
        report.contents += 1;
    } else {
        report.missing += 1;
    }
}

/// The guards, each of which leaves the product cache that is published where
/// it was: returning rolls the transaction back with the deletes in it.
#[expect(
    clippy::cast_precision_loss,
    reason = "a build of 2^53 rows is not the one being read"
)]
fn refuse(report: &Report, read: i64, before: Option<i64>) -> Result<()> {
    if report.products == 0 || report.decks == 0 || report.contents == 0 || report.deck_cards == 0 {
        return Err(Error::EmptySync);
    }
    if read >= ENOUGH_READ && report.missing as f64 > read as f64 * ALLOWED_MISSING {
        return Err(Error::MissingPrintings {
            missing: report.missing,
            read,
        });
    }
    if let Some(before) = before
        && (report.products as f64) < before as f64 * LEAST_KEPT
    {
        return Err(Error::ShrunkSync {
            written: report.products,
            before,
        });
    }
    Ok(())
}

/// A set code as the card cache spells it — see `crate::boosters`.
fn code(set_code: &str) -> String {
    set_code.to_lowercase()
}

/// Which finish a board entry is. Both flags, never the foil one alone: an
/// etched printing sets that too, and is a finish of its own.
fn finish(entry: &Board) -> &'static str {
    printed(entry.is_foil, entry.is_etched)
}

fn printed(foil: bool, etched: bool) -> &'static str {
    if etched {
        "etched"
    } else if foil {
        "foil"
    } else {
        "nonfoil"
    }
}

/// List entries the catalog will leave out, counted inside the transaction
/// that wrote them so the number describes this sync rather than a later one.
async fn digital(tx: &mut Transaction<'_, Sqlite>) -> Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM deck_cards d
         JOIN cards c ON c.id = d.scryfall_id
         WHERE c.seq IS NULL",
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(count)
}

/// Products held before this sync, which is what its own count is weighed
/// against. `None` where the cache holds none yet.
async fn count(pool: &SqlitePool) -> Result<Option<i64>> {
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM products")
        .fetch_one(pool)
        .await?;
    Ok((count > 0).then_some(count))
}

#[cfg(test)]
mod tests {
    use super::{ENOUGH_READ, Report, refuse};
    use crate::Error;

    /// A build big enough for the share below to mean anything.
    fn filled(missing: i64) -> Report {
        Report {
            products: 100,
            decks: 100,
            deck_cards: 100,
            contents: 100,
            missing,
            ..Report::default()
        }
    }

    #[test]
    fn a_hundredth_of_the_rows_reaching_nothing_is_allowed() {
        assert!(refuse(&filled(ENOUGH_READ / 100), ENOUGH_READ, None).is_ok());
        assert!(matches!(
            refuse(&filled(ENOUGH_READ / 100 + 1), ENOUGH_READ, None),
            Err(Error::MissingPrintings { .. })
        ));
    }

    /// Below that many rows the share says nothing, so the guard holds off.
    #[test]
    fn a_small_build_is_judged_on_being_empty_alone() {
        let read = ENOUGH_READ - 1;
        assert!(refuse(&filled(read), read, None).is_ok());
    }

    #[test]
    fn a_twentieth_fewer_products_than_last_time_refuses() {
        let mut report = filled(0);
        report.products = 95;
        assert!(refuse(&report, 100, Some(100)).is_ok());
        report.products = 94;
        assert!(matches!(
            refuse(&report, 100, Some(100)),
            Err(Error::ShrunkSync { .. })
        ));
    }
}
