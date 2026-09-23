//! Parsing tests against real Scryfall responses, captured 2026-09-07.
//!
//! The fixture is one printing per irregular layout, unmodified, because the
//! shapes worth testing are the ones Scryfall actually emits rather than the
//! ones the docs imply.

use std::io::Cursor;

use manaweb_scryfall::{BulkIndex, BulkKind, Card, CardStream, Error};

const LAYOUTS: &str = include_str!("fixtures/layouts.jsonl");
const BULK_INDEX: &str = include_str!("fixtures/bulk-data.json");

fn stream(ndjson: impl Into<Vec<u8>>) -> CardStream {
    CardStream::new(Cursor::new(ndjson.into()))
}

async fn collect(ndjson: impl Into<Vec<u8>>) -> Vec<Card> {
    let mut stream = stream(ndjson);
    let mut cards = Vec::new();
    while let Some(card) = stream.try_next().await.expect("fixture should parse") {
        cards.push(card);
    }
    cards
}

fn by_layout<'a>(cards: &'a [Card], layout: &str) -> &'a Card {
    cards
        .iter()
        .find(|card| card.layout == layout)
        .unwrap_or_else(|| panic!("fixture has no {layout} card"))
}

#[tokio::test]
async fn every_layout_in_the_fixture_parses() {
    let cards = collect(LAYOUTS).await;
    assert_eq!(cards.len(), 14);
    for card in &cards {
        assert!(!card.name.is_empty(), "{} has no name", card.id);
        assert!(!card.set_code.is_empty(), "{} has no set", card.name);
        assert!(
            !card.legalities.is_empty(),
            "{} has no legalities",
            card.name
        );
    }
}

/// The trap the roadmap calls out: a `NOT NULL` on any of these would fail on
/// the first sync, ~80 printings in.
#[tokio::test]
async fn reversible_cards_omit_top_level_gameplay_fields() {
    let cards = collect(LAYOUTS).await;
    let card = by_layout(&cards, "reversible_card");

    assert!(card.oracle_id.is_none());
    assert!(card.cmc.is_none());
    assert!(card.mana_cost.is_none());
    assert!(card.type_line.is_none());
    assert!(card.oracle_text.is_none());
    assert!(card.colors.is_none());
    assert!(
        card.card_faces.is_some(),
        "everything above is on the faces"
    );
}

#[tokio::test]
async fn transform_layouts_drop_mana_cost_but_keep_a_type_line() {
    let cards = collect(LAYOUTS).await;
    for layout in ["transform", "modal_dfc", "art_series", "double_faced_token"] {
        let card = by_layout(&cards, layout);
        assert!(card.mana_cost.is_none(), "{layout} kept a mana cost");
        assert!(card.type_line.is_some(), "{layout} lost its type line");
        assert!(card.card_faces.is_some(), "{layout} has no faces");
    }
}

/// Split, adventure and flip cards keep everything at the top level, so the
/// faces are the only place the halves are distinguishable.
#[tokio::test]
async fn card_faces_survive_as_original_json() {
    let cards = collect(LAYOUTS).await;
    let card = by_layout(&cards, "split");
    let faces = card.card_faces.as_ref().expect("split cards have faces");
    let faces: Vec<serde_json::Value> =
        serde_json::from_str(faces.get()).expect("faces are an array");

    assert_eq!(faces.len(), 2);
    assert!(faces[0]["name"].is_string());
    assert!(faces[0]["mana_cost"].is_string());
}

#[tokio::test]
async fn meld_cards_have_no_faces() {
    let cards = collect(LAYOUTS).await;
    let card = by_layout(&cards, "meld");
    assert!(card.card_faces.is_none());
    assert!(card.type_line.is_some());
}

#[tokio::test]
async fn blank_lines_are_skipped() {
    let ndjson = concat!(
        r#"{"id":"0000419b-0bba-4488-8f7a-6194544ce91e","name":"Forest","lang":"en","released_at":"2024-08-02","layout":"normal","set":"blb","set_name":"Bloomburrow","set_type":"expansion","collector_number":"280","rarity":"common","color_identity":["G"],"digital":false,"promo":false,"reprint":true,"variation":false,"oversized":false,"booster":true,"full_art":false,"textless":false,"reserved":false,"border_color":"black","frame":"2015","image_status":"highres_scan"}"#,
        "\n\n   \n",
    );
    assert_eq!(collect(ndjson).await.len(), 1);
}

#[tokio::test]
async fn a_bad_line_names_itself_and_the_stream_carries_on() {
    let good = LAYOUTS.lines().next().expect("fixture is not empty");
    let mut stream = stream(format!("{good}\nnot json\n{good}\n"));

    assert!(stream.try_next().await.expect("line 1 is a card").is_some());
    match stream.try_next().await {
        Err(Error::Parse { line, .. }) => assert_eq!(line, 2),
        other => panic!("expected a parse error on line 2, got {other:?}"),
    }
    assert!(stream.try_next().await.expect("line 3 is a card").is_some());
    assert_eq!(stream.line(), 3);
}

#[tokio::test]
async fn gzipped_input_reads_the_same_cards() {
    use async_compression::tokio::write::GzipEncoder;
    use tokio::io::AsyncWriteExt as _;

    let mut encoder = GzipEncoder::new(Vec::new());
    encoder.write_all(LAYOUTS.as_bytes()).await.unwrap();
    encoder.shutdown().await.unwrap();

    let mut stream = CardStream::gzipped(Cursor::new(encoder.into_inner()));
    let mut ids = Vec::new();
    while let Some(card) = stream.try_next().await.expect("gzip should decode") {
        ids.push(card.id);
    }

    let expected: Vec<_> = collect(LAYOUTS).await.iter().map(|card| card.id).collect();
    assert_eq!(ids, expected);
}

#[tokio::test]
async fn bulk_index_finds_the_default_cards_file() {
    let index: BulkIndex = serde_json::from_str(BULK_INDEX).expect("index should parse");
    let bulk = index
        .get(BulkKind::DefaultCards)
        .expect("index lists default_cards");

    assert!(bulk.jsonl_download_uri.ends_with(".jsonl.gz"));
    assert!(bulk.compressed_size > 0);
    assert!(index.get(BulkKind::AllCards).is_some());
}

/// The index carries types this crate doesn't name, and must not choke on them.
#[tokio::test]
async fn bulk_index_tolerates_unknown_types() {
    let index: BulkIndex = serde_json::from_str(BULK_INDEX).expect("index should parse");
    assert!(index.data.iter().any(|entry| entry.kind == "art_tags"));
}

#[tokio::test]
async fn non_english_printings_keep_their_printed_name() {
    let cards = collect(LAYOUTS).await;
    assert!(
        cards.iter().all(|card| card.printed_name.is_none()),
        "the fixture is English, so nothing should carry a printed name"
    );
}

#[tokio::test]
async fn colors_sort_into_wubrg_order() {
    use manaweb_scryfall::Color::{B, G, R, U, W};

    let mut colors = vec![G, B, W, R, U];
    colors.sort();
    assert_eq!(colors, [W, U, B, R, G]);
}

#[tokio::test]
async fn a_last_line_with_no_newline_still_reads() {
    let good = LAYOUTS.lines().next().expect("fixture is not empty");
    assert_eq!(collect(good.to_owned()).await.len(), 1);
}

// An unattended sync on a 1GB box, so a file that arrives with no newline in
// it has to stop the read rather than be held whole.
#[tokio::test]
async fn a_line_past_the_ceiling_is_refused() {
    let huge = format!("{{\"id\":\"{}\"", "x".repeat(2 << 20));

    let failure = stream(huge)
        .try_next()
        .await
        .expect_err("a line this long should not be read");

    let manaweb_scryfall::Error::Io(why) = failure else {
        panic!("wanted an io error, got {failure}");
    };
    assert!(why.to_string().contains("over"), "{why}");
}
