//! Booster cache tests, against real MTGJSON tables and the real printings
//! they resolve to, captured 2026-11-26.
//!
//! The tables are `blb`'s play config and `mh3`'s, as `crates/mtgjson` holds
//! them, less the rows of a third whose sheets it does not carry — the live
//! tables have no such row. The cards are the eleven printings the
//! pool rows name, fetched by the ids `cardIdentifiers` gives for them. So
//! the join under test is the real one rather than a pairing arranged to
//! succeed.

use std::io::Cursor;

use manaweb_core::boosters::{self, Report, Tables};
use manaweb_core::{Error, cards, open_memory};
use manaweb_mtgjson::Rows;
use manaweb_scryfall::{BulkData, CardStream};
use serde::de::DeserializeOwned;
use sqlx::SqlitePool;

const CARDS: &str = include_str!("fixtures/boosters/cards.jsonl");
const IDENTITIES: &str = include_str!("fixtures/boosters/identities.csv");
const SHEETS: &str = include_str!("fixtures/boosters/sheets.csv");
const WEIGHTS: &str = include_str!("fixtures/boosters/weights.csv");
const CONTENTS: &str = include_str!("fixtures/boosters/contents.csv");
const SHEET_CARDS: &str = include_str!("fixtures/boosters/sheet-cards.csv");

fn rows<T: DeserializeOwned + Send + 'static>(csv: &str) -> Rows<T> {
    Rows::new(Cursor::new(csv.as_bytes().to_vec()))
}

fn tables() -> Tables {
    Tables {
        identities: rows(IDENTITIES),
        sheets: rows(SHEETS),
        variants: rows(WEIGHTS),
        slots: rows(CONTENTS),
        pool: rows(SHEET_CARDS),
    }
}

/// Deserialized rather than constructed, so the test doesn't need `uuid`.
fn bulk() -> BulkData {
    serde_json::from_value(serde_json::json!({
        "id": "e2ef41e3-5778-4bc2-af3f-78eca4dd9c23",
        "type": "default_cards",
        "name": "Default Cards",
        "updated_at": "2026-11-16T10:06:16.534+00:00",
        "jsonl_download_uri": "https://example.invalid/default-cards.jsonl.gz",
        "compressed_size": 78_059_432_u64,
    }))
    .expect("bulk data fixture should parse")
}

/// A cache holding the printings the pool names, which is what the sync
/// resolves against.
async fn seeded() -> SqlitePool {
    let pool = open_memory().await.expect("migrations should apply");
    cards::replace(
        &pool,
        &bulk(),
        &mut CardStream::new(Cursor::new(CARDS.as_bytes().to_vec())),
    )
    .await
    .expect("card fixture should sync");
    pool
}

async fn synced() -> (SqlitePool, Report) {
    let pool = seeded().await;
    let report = boosters::replace(&pool, tables())
        .await
        .expect("booster fixture should sync");
    (pool, report)
}

#[tokio::test]
async fn every_table_lands_and_the_pool_resolves() {
    let (_pool, report) = synced().await;

    assert_eq!(report.sheets, 17);
    assert_eq!(report.variants, 10);
    assert_eq!(report.slots, 69);
    // Every pool row reaches a printing the cache holds, which is the join
    // this whole subject rests on.
    assert_eq!(report.pool, 11);
    assert_eq!(report.missing, 0);
    // All eleven are paper, so none of them is a row the catalog leaves out.
    assert_eq!(report.digital, 0);
}

/// A sheet belongs to one configuration of one set, so the same name under
/// two of them is two sheets and not a collision.
#[tokio::test]
async fn a_sheet_name_is_keyed_by_its_configuration() {
    let (pool, _) = synced().await;

    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM booster_sheets WHERE name = ?")
        .bind("common")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);

    let (sets,): (i64,) =
        sqlx::query_as("SELECT count(DISTINCT set_code || '/' || booster) FROM booster_sheets")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sets, 2);
}

/// What a wrapper prints, read back out of the database rather than off the
/// rows that went in.
#[tokio::test]
async fn the_slot_line_comes_back_out_of_the_tables() {
    let (pool, _) = synced().await;

    // A sheet no variant draws from is none of that slot, so the floor comes
    // from the variants that skip it rather than from a row saying zero.
    let line: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT s.name,
                CASE WHEN count(l.variant) < (
                    SELECT count(*) FROM booster_variants v
                    WHERE v.set_code = s.set_code AND v.booster = s.booster
                ) THEN 0 ELSE min(l.picks) END,
                max(l.picks)
         FROM booster_sheets s JOIN booster_slots l ON l.sheet_id = s.id
         WHERE s.set_code = 'BLB' AND s.booster = 'play'
         GROUP BY s.id ORDER BY s.name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    let said: Vec<(&str, i64, i64)> = line
        .iter()
        .map(|(name, least, most)| (name.as_str(), *least, *most))
        .collect();
    assert_eq!(
        said,
        [
            ("common", 6, 7),
            ("foil", 1, 1),
            ("foilLand", 0, 1),
            ("land", 0, 1),
            ("rareMythicWithShowcase", 1, 1),
            ("specialGuest", 0, 1),
            ("uncommon", 3, 3),
            ("wildcard", 1, 1),
        ]
    );
}

/// The card's own direction: the index a "how do I get this" answer reads.
#[tokio::test]
async fn a_printing_names_the_sheets_it_sits_on() {
    let (pool, _) = synced().await;

    let found: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT s.set_code, s.booster, s.name, p.weight
         FROM booster_pool p JOIN booster_sheets s ON s.id = p.sheet_id
         JOIN cards c ON c.id = p.scryfall_id
         WHERE c.set_code = 'blb' AND c.collector_number = '286'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(found.len(), 1);
    let (set, booster, sheet, weight) = &found[0];
    assert_eq!(
        (set.as_str(), booster.as_str(), sheet.as_str()),
        ("BLB", "play", "rareMythicWithShowcase")
    );
    // Carried from the row rather than counted, a sheet being an uneven draw.
    assert!(*weight > 0);
}

/// A second sync replaces rather than adds, which is what makes the cache
/// disposable.
#[tokio::test]
async fn syncing_twice_leaves_one_copy() {
    let (pool, first) = synced().await;
    let again = boosters::replace(&pool, tables())
        .await
        .expect("a second sync should replace the first");

    assert_eq!(first, again);
    let (sheets,): (i64,) = sqlx::query_as("SELECT count(*) FROM booster_sheets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sheets, 17);
}

/// The cache resolves against the card cache, so a sync run before it has
/// nothing to resolve against and must leave what is published alone.
#[tokio::test]
async fn a_sync_before_the_cards_refuses() {
    let pool = open_memory().await.expect("migrations should apply");

    let refused = boosters::replace(&pool, tables()).await;

    assert!(
        matches!(refused, Err(Error::EmptySync)),
        "expected an empty sync, got {refused:?}"
    );
    let (sheets,): (i64,) = sqlx::query_as("SELECT count(*) FROM booster_sheets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sheets, 0, "a refused sync should write nothing");
}

/// A refusal rolls back, so the previous build stays published rather than
/// being replaced by half of a worse one.
#[tokio::test]
async fn a_refused_sync_keeps_the_last_one() {
    let (pool, _) = synced().await;

    let refused = boosters::replace(
        &pool,
        Tables {
            identities: rows(IDENTITIES),
            sheets: rows("setCode,boosterName,sheetName,sheetIsFoil,sheetHasBalanceColors,sheetTotalWeight\n"),
            variants: rows(WEIGHTS),
            slots: rows(CONTENTS),
            pool: rows(SHEET_CARDS),
        },
    )
    .await;

    assert!(
        matches!(refused, Err(Error::EmptySync)),
        "expected an empty sync, got {refused:?}"
    );
    let (sheets,): (i64,) = sqlx::query_as("SELECT count(*) FROM booster_sheets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sheets, 17, "the last good sync should still be there");
}
