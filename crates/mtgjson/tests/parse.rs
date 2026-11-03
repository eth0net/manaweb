//! Parsing tests against real MTGJSON tables, captured 2026-11-03 from build
//! `5.3.0+20261103`.
//!
//! The fixtures are the fewest products that cover every shape a `contents`
//! entry takes, unmodified, plus the decks and identifiers they reach.

use std::io::Cursor;

use manaweb_mtgjson::{Deck, Identity, Meta, Product, Rows};
use serde::de::DeserializeOwned;
use uuid::Uuid;

const PRODUCTS: &str = include_str!("fixtures/products.csv");
const DECKS: &str = include_str!("fixtures/decks.csv");
const IDENTITIES: &str = include_str!("fixtures/identities.csv");
const TOKEN_IDENTITIES: &str = include_str!("fixtures/token-identities.csv");
const META: &str = include_str!("fixtures/meta.json");

async fn collect<T: DeserializeOwned + Send + 'static>(csv: &str) -> Vec<T> {
    let mut rows = Rows::new(Cursor::new(csv.as_bytes().to_vec()));
    let mut all = Vec::new();
    while let Some(row) = rows.try_next().await.expect("fixture should parse") {
        all.push(row);
    }
    all
}

fn named<'a>(products: &'a [Product], name: &str) -> &'a Product {
    products
        .iter()
        .find(|product| product.name.contains(name))
        .unwrap_or_else(|| panic!("fixture has no product named {name}"))
}

#[tokio::test]
async fn every_content_kind_in_the_fixture_parses() {
    let products: Vec<Product> = collect(PRODUCTS).await;
    assert_eq!(products.len(), 12);

    let held = products.iter().fold([false; 6], |mut seen, product| {
        let contents = &product.contents;
        seen[0] |= !contents.card.is_empty();
        seen[1] |= !contents.deck.is_empty();
        seen[2] |= !contents.sealed.is_empty();
        seen[3] |= !contents.pack.is_empty();
        seen[4] |= !contents.variable.is_empty();
        seen[5] |= !contents.other.is_empty();
        seen
    });
    assert_eq!(
        held, [true; 6],
        "a content kind is missing from the fixture"
    );
}

/// A product naming another is the only way a booster box reaches a card, and
/// the named uuid has to be findable rather than merely well-formed.
#[tokio::test]
async fn sealed_contents_name_a_product_in_the_same_table() {
    let products: Vec<Product> = collect(PRODUCTS).await;
    let bundle = named(&products, "Chocobo Bundle");
    let held: Vec<Uuid> = bundle.contents.sealed.iter().map(|one| one.uuid).collect();

    assert!(held.len() > 1, "a bundle should name several products");
    assert!(
        held.iter()
            .any(|uuid| products.iter().any(|product| product.uuid == *uuid)),
        "no sealed entry resolves inside the fixture"
    );
}

/// `variable` recurses into the same union, so the type has to as well.
#[tokio::test]
async fn variable_contents_hold_whole_configurations() {
    let products: Vec<Product> = collect(PRODUCTS).await;
    let box_set = named(&products, "Festival in a Box");
    let configs = &box_set
        .contents
        .variable
        .first()
        .expect("the fixture's variable product should have configs")
        .configs;

    assert!(configs.len() > 1, "one config is not a variable product");
    // A config is a whole `Contents`, so it recurses as the top level does:
    // this one's arms each name two other products.
    assert!(
        configs.iter().all(|config| config.sealed.len() == 2),
        "a config should hold what a product holds"
    );
    assert!(
        configs
            .iter()
            .all(|config| config.variable_config.len() == 1),
        "a config without its odds reads as equally likely"
    );
}

/// The flags are written independently of `finishes` rather than derived from
/// it, and a collector number is not a number.
#[tokio::test]
async fn card_contents_carry_their_own_flags() {
    let products: Vec<Product> = collect(PRODUCTS).await;
    let cards: Vec<_> = products
        .iter()
        .flat_map(|product| &product.contents.card)
        .collect();

    let etched = cards
        .iter()
        .find(|card| card.etched)
        .expect("the fixture should hold an etched printing");
    assert_eq!(etched.finishes, ["etched"]);
    assert_eq!(etched.number, "2\u{2605}");

    assert!(
        cards.iter().any(|card| card.token),
        "the fixture should hold a token printing"
    );
}

#[tokio::test]
async fn every_board_keys_by_uuid_alone() {
    let decks: Vec<Deck> = collect(DECKS).await;
    assert_eq!(decks.len(), 5);

    // A token sheet is a decklist here, so a mainboard is not a given: 5 of
    // the 3,135 have none and carry only tokens.
    assert!(decks.iter().any(|deck| deck.main_board.is_empty()));
    for deck in &decks {
        let boards = [&deck.main_board, &deck.tokens, &deck.commander];
        assert!(
            boards.iter().any(|board| !board.is_empty()),
            "{} holds nothing at all",
            deck.name
        );
        for card in boards.into_iter().flatten() {
            assert!(card.count > 0, "{} has a zero count", deck.name);
        }
    }
    assert!(
        decks
            .iter()
            .any(|deck| !deck.sealed_product_uuids.is_empty()),
        "no deck names the product that ships it"
    );
}

/// What makes the map many-to-one: a part, not a printing, is what gets a
/// uuid. Every multi-part layout is affected and no single-part one is.
#[tokio::test]
async fn a_multi_part_printing_gets_a_uuid_per_part() {
    let identities: Vec<Identity> = collect(IDENTITIES).await;

    let split: Uuid = "8987644d-5a31-4a4e-9a8a-3d6260ed0fd6".parse().unwrap();
    let parts = identities
        .iter()
        .filter(|one| one.scryfall_id == split)
        .count();
    assert_eq!(parts, 5, "the five-part split should have five uuids");

    let transform: Uuid = "c05a85ef-5ac0-4bd1-8ef1-de2ff84e448d".parse().unwrap();
    assert_eq!(
        identities
            .iter()
            .filter(|one| one.scryfall_id == transform)
            .count(),
        2
    );
}

/// The reason `tokenIdentifiers` is fetched at all: a decklist's `tokens`
/// board resolves nowhere without it.
#[tokio::test]
async fn tokens_are_absent_from_the_card_identifiers() {
    let decks: Vec<Deck> = collect(DECKS).await;
    let cards: Vec<Identity> = collect(IDENTITIES).await;
    let tokens: Vec<Identity> = collect(TOKEN_IDENTITIES).await;

    let wanted: Vec<Uuid> = decks
        .iter()
        .flat_map(|deck| &deck.tokens)
        .map(|card| card.uuid)
        .collect();
    assert!(!wanted.is_empty(), "the fixture should hold token entries");

    for uuid in wanted {
        assert!(
            !cards.iter().any(|one| one.uuid == uuid),
            "{uuid} should not be in cardIdentifiers"
        );
        assert!(
            tokens.iter().any(|one| one.uuid == uuid),
            "{uuid} should be in tokenIdentifiers"
        );
    }
}

#[tokio::test]
async fn a_row_that_does_not_parse_names_itself() {
    let mut lines = PRODUCTS.lines();
    let header = lines.next().unwrap();
    let good = lines.next().unwrap();
    let broken = format!("{header}\n{good}\n{header}\n");

    let mut rows = Rows::<Product>::new(Cursor::new(broken.into_bytes()));
    rows.try_next().await.expect("the first row is intact");
    let error = rows.try_next().await.expect_err("the second row is not");

    assert!(
        error.to_string().starts_with("row 2 did not parse"),
        "{error}"
    );
}

#[test]
fn the_build_stamp_parses() {
    let meta = Meta::parse(META).expect("fixture should parse");
    assert_eq!(meta.date.len(), "2026-11-03".len());
    assert!(meta.version.contains('+'), "{}", meta.version);
}
