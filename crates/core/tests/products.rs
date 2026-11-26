//! Product cache tests, against real MTGJSON rows and the real printings they
//! resolve to, captured from build `5.3.0+20261126`.
//!
//! Eight products and the lists they name, less most of each list's boards:
//! the ten a battle pack picks between are there to be picked, so theirs are
//! left out entirely — and `M12` names its ten the same, which is why a list
//! is keyed by its set as well. `ME2`'s is named by no product here, as six
//! hundred of the live lists are, and is the one whose cards are digital.

use std::io::Cursor;

use manaweb_core::products::{self, Report, Tables};
use manaweb_core::{Error, cards, open_memory};
use manaweb_mtgjson::Rows;
use manaweb_scryfall::{BulkData, CardStream};
use serde::de::DeserializeOwned;
use sqlx::SqlitePool;

const CARDS: &str = include_str!("fixtures/products/cards.jsonl");
const IDENTITIES: &str = include_str!("fixtures/products/identities.csv");
const TOKENS: &str = include_str!("fixtures/products/token-identities.csv");
const PRODUCTS: &str = include_str!("fixtures/products/products.csv");
const DECKS: &str = include_str!("fixtures/products/decks.csv");

const BUNDLE: &str = "Bloomburrow Bundle";
const BOX: &str = "Bloomburrow Play Booster Box";
const PACK: &str = "Bloomburrow Play Booster Pack";
const BATTLE: &str = "2013 Core Set Booster Battle Pack";

/// The one printing a product names outright, which is `blb` #386.
const BUNDLE_CARD: &str = "e52caa08-34ae-4c74-83ad-008d17005576";

fn rows<T: DeserializeOwned + Send + 'static>(csv: &str) -> Rows<T> {
    Rows::new(Cursor::new(csv.as_bytes().to_vec()))
}

fn tables() -> Tables {
    Tables {
        identities: rows(IDENTITIES),
        tokens: rows(TOKENS),
        products: rows(PRODUCTS),
        decks: rows(DECKS),
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

/// A cache holding the printings the products and lists name.
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
    let report = products::replace(&pool, tables())
        .await
        .expect("product fixture should sync");
    (pool, report)
}

#[tokio::test]
async fn every_table_lands_and_the_contents_resolve() {
    let (_pool, report) = synced().await;

    assert_eq!(report.products, 10);
    assert_eq!(report.decks, 25);
    assert_eq!(report.deck_cards, 16);
    assert_eq!(report.configs, 111);
    assert_eq!(report.contents, 106);
    // A scene box names a list MTGJSON does not publish, which is the only
    // thing in the fixture reaching nothing — as it is in the live tables.
    assert_eq!(report.missing, 1);
    assert_eq!(report.digital, 2);
}

/// The set code is MTGJSON's upper case going in and the cache's lower case
/// coming out, or a product joins nothing it belongs to.
#[tokio::test]
async fn a_product_is_filed_under_the_cache_s_set_code() {
    let (pool, _) = synced().await;

    let (held,): (i64,) = sqlx::query_as("SELECT count(*) FROM products WHERE set_code = ?")
        .bind("blb")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(held, 4);

    let (packs,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM product_packs WHERE set_code = ? AND booster = ?")
            .bind("blb")
            .bind("play")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(packs, 1);
}

/// A box is its packs, which is what makes the contents recurse.
#[tokio::test]
async fn a_box_holds_the_pack_it_names() {
    let (pool, _) = synced().await;

    let (name, count): (String, i64) = sqlx::query_as(
        "SELECT held.name, s.count
         FROM product_sealed s
         JOIN product_configs c ON c.id = s.config_id
         JOIN products box ON box.uuid = c.product
         JOIN products held ON held.uuid = s.holds
         WHERE box.name = ?",
    )
    .bind(BOX)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!((name.as_str(), count), (PACK, 36));
}

/// Four kinds under one product, numbered across the tables they land in so
/// that reading them together gives the order they were written in.
#[tokio::test]
async fn a_bundle_reads_as_one_list() {
    let (pool, _) = synced().await;

    let held: Vec<(i64, String)> = sqlx::query_as(
        "WITH mine(id) AS (
             SELECT c.id FROM product_configs c JOIN products p ON p.uuid = c.product
             WHERE p.name = ?)
         SELECT position, 'a printing' FROM product_cards WHERE config_id IN mine
         UNION ALL SELECT position, 'a list' FROM product_decks WHERE config_id IN mine
         UNION ALL SELECT position, 'a product' FROM product_sealed WHERE config_id IN mine
         UNION ALL SELECT position, name FROM product_other WHERE config_id IN mine
         ORDER BY position",
    )
    .bind(BUNDLE)
    .fetch_all(&pool)
    .await
    .unwrap();

    let said: Vec<&str> = held.iter().map(|(_, what)| what.as_str()).collect();
    assert_eq!(
        said,
        [
            "a printing",
            "a list",
            "a product",
            "Bloomburrow Spindown",
            "Card-storage box",
            "2 Reference cards",
        ]
    );
    assert_eq!(
        held.iter().map(|(at, _)| *at).collect::<Vec<_>>(),
        [0, 1, 2, 3, 4, 5]
    );
}

/// A config holding configs, which a battle pack does three deep: two packs
/// of two colors, picked from ten pairings. The ten lists it reaches are
/// `M13`'s and not the ten `M12` names identically.
#[tokio::test]
async fn a_product_packed_several_ways_is_a_tree() {
    let (pool, _) = synced().await;

    let deep: Vec<(i64, i64)> = sqlx::query_as(
        "WITH RECURSIVE down(id, product, deep) AS (
             SELECT id, product, 0 FROM product_configs WHERE parent_id IS NULL
             UNION ALL
             SELECT c.id, down.product, down.deep + 1
             FROM product_configs c JOIN down ON c.parent_id = down.id)
         SELECT deep, count(*) FROM down
         WHERE product = (SELECT uuid FROM products WHERE name = ?)
         GROUP BY deep ORDER BY deep",
    )
    .bind(BATTLE)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(deep, [(0, 1), (1, 1), (2, 20), (3, 80)]);

    // Every leaf of that tree names a list, and the same list over and over:
    // what varies is which pair of colors a copy holds.
    let (named, distinct): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(DISTINCT d.deck_id)
         FROM product_decks d JOIN product_configs c ON c.id = d.config_id
         WHERE c.product = (SELECT uuid FROM products WHERE name = ?)",
    )
    .bind(BATTLE)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((named, distinct), (80, 10));

    let (elsewhere,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM product_decks d
         JOIN decks s ON s.id = d.deck_id
         WHERE s.set_code <> 'm13'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        elsewhere, 4,
        "only the bundle, the starter kit and the commander deck"
    );
}

/// A board naming one printing twice is one row and both counts, there being
/// no second card to hold the second row.
#[tokio::test]
async fn a_board_naming_a_card_twice_is_one_row() {
    let (pool, report) = synced().await;

    assert_eq!(report.merged, 1);

    let held: Vec<(i64,)> = sqlx::query_as(
        "SELECT count FROM deck_cards d JOIN decks s ON s.id = d.deck_id
         WHERE s.name = ? AND d.board = 'tokens'",
    )
    .bind("Mishra's Burnished Banner")
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(held, [(2,)]);
}

/// The card's own direction: a printing naming the products and lists it can
/// be got from, which is the index that whole screen reads.
#[tokio::test]
async fn a_printing_names_where_it_comes_from() {
    let (pool, _) = synced().await;

    let (product,): (String,) = sqlx::query_as(
        "SELECT p.name FROM product_cards k
         JOIN product_configs c ON c.id = k.config_id
         JOIN products p ON p.uuid = c.product
         JOIN cards card ON card.id = k.scryfall_id
         WHERE card.set_code = 'blb' AND card.collector_number = '386'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(product, BUNDLE);

    let lists: Vec<(String,)> = sqlx::query_as(
        "SELECT s.name FROM deck_cards d
         JOIN decks s ON s.id = d.deck_id
         JOIN cards card ON card.id = d.scryfall_id
         WHERE card.set_code = 'brc' AND d.board = 'commander'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(lists, [("Mishra's Burnished Banner".to_owned(),)]);
}

/// A second sync replaces rather than adds, which is what makes the cache
/// disposable.
#[tokio::test]
async fn syncing_twice_leaves_one_copy() {
    let (pool, first) = synced().await;
    let again = products::replace(&pool, tables())
        .await
        .expect("a second sync should replace the first");

    assert_eq!(first, again);
    let (held,): (i64,) = sqlx::query_as("SELECT count(*) FROM products")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(held, 10);
}

/// The cache resolves against the card cache, so a sync run before it places
/// no card at all and must leave what is published alone.
#[tokio::test]
async fn a_sync_before_the_cards_refuses() {
    let pool = open_memory().await.expect("migrations should apply");

    let refused = products::replace(&pool, tables()).await;

    assert!(
        matches!(refused, Err(Error::EmptySync)),
        "expected an empty sync, got {refused:?}"
    );
    let (held,): (i64,) = sqlx::query_as("SELECT count(*) FROM products")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(held, 0, "a refused sync should write nothing");
}

/// A refusal rolls back, so the previous build stays published rather than
/// being replaced by half of a worse one.
#[tokio::test]
async fn a_refused_sync_keeps_the_last_one() {
    let (pool, _) = synced().await;

    let refused = products::replace(
        &pool,
        Tables {
            identities: rows(IDENTITIES),
            tokens: rows(TOKENS),
            products: rows(
                "setCode,cardCount,category,contents,identifiers,isFoilOnly,name,\
                 productSize,purchaseUrls,releaseDate,subtype,uuid\n",
            ),
            decks: rows(DECKS),
        },
    )
    .await;

    assert!(
        matches!(refused, Err(Error::EmptySync)),
        "expected an empty sync, got {refused:?}"
    );
    let (held,): (i64,) = sqlx::query_as("SELECT count(*) FROM products")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(held, 10, "the last good sync should still be there");
}

/// A product can name a printing of a set the cache has never taken — fifty
/// of them do — and that is counted rather than quietly dropped.
#[tokio::test]
async fn a_printing_the_cache_lacks_is_counted() {
    let pool = open_memory().await.expect("migrations should apply");
    let kept: Vec<&str> = CARDS
        .lines()
        .filter(|line| !line.contains(BUNDLE_CARD))
        .collect();
    assert_eq!(kept.len(), CARDS.lines().count() - 1);
    let held = kept.join("\n");
    cards::replace(
        &pool,
        &bulk(),
        &mut CardStream::new(Cursor::new(held.into_bytes())),
    )
    .await
    .expect("the trimmed card fixture should sync");

    let report = products::replace(&pool, tables())
        .await
        .expect("a product naming one missing printing should still sync");

    assert_eq!(report.missing, 2, "the scene box's list, and this printing");
    let (placed,): (i64,) = sqlx::query_as("SELECT count(*) FROM product_cards")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(placed, 0);
}
