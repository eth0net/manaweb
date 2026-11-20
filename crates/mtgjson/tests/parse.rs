//! Parsing tests against real MTGJSON tables, unmodified. The products, decks
//! and identifiers were captured 2026-11-03 from build `5.3.0+20261103`, the
//! booster tables 2026-11-19 from `5.3.0+20261118`.
//!
//! The product fixtures are the fewest that cover every shape a `contents`
//! entry takes, plus the decks and identifiers they reach. The booster ones
//! are `blb`'s play config, which `docs/products.md` works through, `mh3`'s,
//! whose weights are scaled far past what 32 bits hold, and `blb`'s
//! collector-sample, so that neither half of a config's key goes unread.

use std::io::Cursor;

use manaweb_mtgjson::{Deck, Identity, Meta, Product, Pull, Rows, Sheet, Slot, Variant};
use serde::de::DeserializeOwned;
use uuid::Uuid;

const PRODUCTS: &str = include_str!("fixtures/products.csv");
const DECKS: &str = include_str!("fixtures/decks.csv");
const IDENTITIES: &str = include_str!("fixtures/identities.csv");
const TOKEN_IDENTITIES: &str = include_str!("fixtures/token-identities.csv");
const META: &str = include_str!("fixtures/meta.json");
const BOOSTER_CONTENTS: &str = include_str!("fixtures/booster-contents.csv");
const BOOSTER_WEIGHTS: &str = include_str!("fixtures/booster-weights.csv");
const BOOSTER_SHEETS: &str = include_str!("fixtures/booster-sheets.csv");
const BOOSTER_SHEET_CARDS: &str = include_str!("fixtures/booster-sheet-cards.csv");

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
    assert_eq!(decks.len(), 7);

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
        .filter_map(|card| card.uuid)
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

/// The whole table fails on a strict uuid, and a lenient one has to say so
/// rather than hand back something that reads as an ordinary card.
#[tokio::test]
async fn a_board_entry_may_name_nothing_mtgjson_knows() {
    let decks: Vec<Deck> = collect(DECKS).await;
    let absent = decks
        .iter()
        .flat_map(|deck| &deck.tokens)
        .filter(|card| card.uuid.is_none())
        .count();

    assert!(
        absent > 0,
        "the fixture should hold a `not_in_mtgjson` entry"
    );
}

/// The two flags are not alternatives, so whichever is read first decides
/// the answer and only one order is right.
#[tokio::test]
async fn an_etched_entry_is_foil_as_well() {
    let decks: Vec<Deck> = collect(DECKS).await;
    let etched: Vec<_> = decks
        .iter()
        .flat_map(|deck| deck.main_board.iter().chain(&deck.display_commander))
        .filter(|card| card.is_etched)
        .collect();

    assert!(
        !etched.is_empty(),
        "the fixture should hold an etched entry"
    );
    assert!(etched.iter().all(|card| card.is_foil));
}

/// The two sets the booster fixtures hold.
const BLB: &str = "BLB";
const MH3: &str = "MH3";

/// A variant index is numbered within its own config, so a set alone does not
/// key one.
const BLB_PLAY: (&str, &str) = (BLB, "play");
const MH3_PLAY: (&str, &str) = (MH3, "play");

/// What one sheet's cards weigh together, as the table gives it.
fn total(sheets: &[Sheet], set: &str, sheet: &str) -> u64 {
    sheets
        .iter()
        .find(|one| one.set_code == set && one.sheet_name == sheet)
        .unwrap_or_else(|| panic!("fixture has no {set} {sheet} sheet"))
        .sheet_total_weight
}

/// The least and greatest a sheet is picked over every variant of a config,
/// counting a variant the sheet is missing from as none of it.
///
/// A variant index belongs to its config and to no other, so both halves of
/// the key are needed before any of them are compared.
fn picks(slots: &[Slot], config: (&str, &str), sheet: &str) -> (u32, u32) {
    let within: Vec<&Slot> = slots
        .iter()
        .filter(|slot| (slot.set_code.as_str(), slot.booster_name.as_str()) == config)
        .collect();
    let variants: Vec<u32> = {
        let mut held: Vec<u32> = within.iter().map(|slot| slot.booster_index).collect();
        held.sort_unstable();
        held.dedup();
        held
    };
    let over: Vec<u32> = variants
        .iter()
        .map(|index| {
            within
                .iter()
                .find(|slot| slot.booster_index == *index && slot.sheet_name == sheet)
                .map_or(0, |slot| slot.sheet_picks)
        })
        .collect();
    (
        over.iter().copied().min().unwrap_or(0),
        over.iter().copied().max().unwrap_or(0),
    )
}

/// What a wrapper prints is the picks alone — no weight is read here, which is
/// the whole point: the slot line needs three of the four tables not at all.
#[tokio::test]
async fn a_wrapper_s_line_falls_out_of_the_picks() {
    let slots: Vec<Slot> = collect(BOOSTER_CONTENTS).await;

    assert_eq!(picks(&slots, BLB_PLAY, "common"), (6, 7));
    assert_eq!(picks(&slots, BLB_PLAY, "uncommon"), (3, 3));
    assert_eq!(picks(&slots, BLB_PLAY, "rareMythicWithShowcase"), (1, 1));
    // Absent from two of the four variants, which is where the zero comes
    // from rather than from a variant picking none of it.
    assert_eq!(picks(&slots, BLB_PLAY, "specialGuest"), (0, 1));
    // Two sheets, and no variant draws from both.
    assert_eq!(picks(&slots, BLB_PLAY, "land"), (0, 1));
    assert_eq!(picks(&slots, BLB_PLAY, "foilLand"), (0, 1));

    // Six variants against the other's four, and the sheet names are its own.
    assert_eq!(picks(&slots, MH3_PLAY, "common"), (5, 7));
    assert_eq!(picks(&slots, MH3_PLAY, "newUncommon"), (3, 3));
    assert_eq!(picks(&slots, MH3_PLAY, "rareMythicWithShowcase"), (0, 0));
    // Two of the six take no land at all, so neither sheet reaches every
    // variant and the pair does not cover the config either.
    assert_eq!(picks(&slots, MH3_PLAY, "land"), (0, 1));
    assert_eq!(picks(&slots, MH3_PLAY, "foilLand"), (0, 1));

    // A sheet of the set's other config, which this one never draws from.
    assert_eq!(picks(&slots, BLB_PLAY, "foilUncommon"), (0, 0));
}

#[tokio::test]
async fn a_variant_s_weight_is_a_share_of_its_config() {
    let variants: Vec<Variant> = collect(BOOSTER_WEIGHTS).await;
    let blb: Vec<&Variant> = variants.iter().filter(|one| one.set_code == BLB).collect();
    let total: u64 = blb.iter().map(|one| one.booster_weight).sum();

    assert_eq!(blb.len(), 4);
    assert_eq!(total, 1000);
    // The commonest variant, which is the one with no Special Guest in it.
    let most = blb
        .iter()
        .max_by_key(|one| one.booster_weight)
        .expect("fixture has variants");
    assert_eq!(most.booster_index, 0);
    assert_eq!(most.booster_weight, 788);
    // Nothing fixes the total, so the other config's is its own.
    let mh3: u64 = variants
        .iter()
        .filter(|one| one.set_code == MH3)
        .map(|one| one.booster_weight)
        .sum();
    assert_eq!(mh3, 640);
}

#[tokio::test]
async fn only_the_foil_sheets_say_they_are_foil() {
    let sheets: Vec<Sheet> = collect(BOOSTER_SHEETS).await;
    let foil: Vec<&str> = sheets
        .iter()
        .filter(|sheet| sheet.set_code == BLB && sheet.sheet_is_foil)
        .map(|sheet| sheet.sheet_name.as_str())
        .collect();

    assert_eq!(foil, ["foil", "foilLand"]);
    // The denominator a pull's own weight sits over, given rather than summed.
    assert_eq!(total(&sheets, BLB, "rareMythicWithShowcase"), 840);
    // Scaled to a common denominator, so a 32-bit column is 366 times too
    // narrow for it.
    assert_eq!(total(&sheets, MH3, "wildcard"), 1_509_042_889_200);
}

/// A sheet is not a uniform draw, which is what makes a pull's weight worth
/// carrying rather than counting the rows.
#[tokio::test]
async fn a_pull_carries_its_own_weight() {
    let pulls: Vec<Pull> = collect(BOOSTER_SHEET_CARDS).await;
    let mut rares: Vec<u64> = pulls
        .iter()
        .filter(|pull| pull.sheet_name == "rareMythicWithShowcase")
        .map(|pull| pull.card_weight)
        .collect();
    rares.sort_unstable();

    assert_eq!(rares, [1, 2, 4, 8, 12]);
    assert!(pulls.iter().all(|pull| pull.card_weight > 0));
    // A single card can outgrow the column too, on a sheet scaled that far.
    let widest = pulls
        .iter()
        .map(|pull| pull.card_weight)
        .max()
        .expect("fixture has pulls");
    assert_eq!(widest, 8_059_369_395);
}
