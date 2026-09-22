//! Card cache tests, against real printings captured 2026-09-07.
//!
//! Four cards, each carrying something the schema has to survive: a plain
//! multicolor creature, a `reversible_card` with no top-level `oracle_id`, a
//! transform layout, and a Japanese printing with a `printed_name`.

use std::io::Cursor;

use manaweb_core::cards::{self, Search, SyncReport};
use manaweb_core::{Error, open_memory};
use manaweb_scryfall::{BulkData, CardStream};
use sqlx::SqlitePool;

const CARDS: &str = include_str!("fixtures/cards.jsonl");

/// Deserialized rather than constructed, so the test doesn't need `uuid`.
fn bulk(updated_at: &str) -> BulkData {
    serde_json::from_value(serde_json::json!({
        "id": "e2ef41e3-5778-4bc2-af3f-78eca4dd9c23",
        "type": "default_cards",
        "name": "Default Cards",
        "updated_at": updated_at,
        "jsonl_download_uri": "https://example.invalid/default-cards.jsonl.gz",
        "compressed_size": 78_059_432_u64,
    }))
    .expect("bulk data fixture should parse")
}

fn stream(ndjson: impl Into<Vec<u8>>) -> CardStream {
    CardStream::new(Cursor::new(ndjson.into()))
}

async fn seeded() -> (SqlitePool, SyncReport) {
    let pool = open_memory().await.expect("migrations should apply");
    let report = cards::replace(
        &pool,
        &bulk("2026-09-06T21:05:43.673+00:00"),
        &mut stream(CARDS),
    )
    .await
    .expect("fixture should sync");
    (pool, report)
}

/// The columns these tests assert on, across both tables. sqlx 0.9 only takes
/// `&'static str` SQL, which rules out building the column name into the query.
#[derive(Debug, sqlx::FromRow)]
struct Row {
    oracle_id: String,
    type_line: Option<String>,
    mana_cost: Option<String>,
    card_faces: Option<String>,
    colors: Option<String>,
    color_identity: String,
    layout: String,
}

async fn row(pool: &SqlitePool, card: &str) -> Row {
    sqlx::query_as(
        "SELECT o.id AS oracle_id, o.type_line, o.mana_cost, o.colors,
                o.color_identity, c.card_faces, c.layout
         FROM oracle o
         JOIN cards c ON c.oracle_id = o.id
         WHERE o.name LIKE ?",
    )
    .bind(format!("{card}%"))
    .fetch_one(pool)
    .await
    .expect("card should be in the cache")
}

#[tokio::test]
async fn migrations_apply_to_an_empty_database() {
    let pool = open_memory().await.expect("migrations should apply");
    assert_eq!(cards::count(&pool).await.unwrap(), 0);
    assert_eq!(
        cards::last_synced(&pool, "default_cards").await.unwrap(),
        None
    );
}

#[tokio::test]
async fn replace_writes_every_card_and_records_the_file() {
    let (pool, report) = seeded().await;

    assert_eq!(
        report,
        SyncReport {
            written: 4,
            cards: 4,
            skipped: 0
        }
    );
    assert_eq!(cards::count(&pool).await.unwrap(), 4);
    assert_eq!(
        cards::last_synced(&pool, "default_cards")
            .await
            .unwrap()
            .as_deref(),
        Some("2026-09-06T21:05:43.673+00:00"),
    );
}

/// The incident this guards against: an upgraded container read a cache that
/// predated a migration as current, skipped the sync and exported the new
/// column as nulls.
#[tokio::test]
async fn a_cache_from_before_a_migration_is_not_synced() {
    let (pool, _) = seeded().await;
    sqlx::query("UPDATE bulk_sync SET schema_version = schema_version - 1")
        .execute(&pool)
        .await
        .expect("the sync should have recorded a schema");

    assert_eq!(
        cards::last_synced(&pool, "default_cards").await.unwrap(),
        None
    );
}

/// Scryfall gives `reversible_card` printings no top-level `oracle_id`, so the
/// cache lifts it off the faces. Without that, a card you own can't be put in a
/// deck, since design entries key on `oracle_id`.
#[tokio::test]
async fn reversible_cards_get_their_oracle_id_from_the_faces() {
    let (pool, _) = seeded().await;

    let jinnie = row(&pool, "Jinnie Fay").await;
    assert_eq!(jinnie.oracle_id, "61fbaaf2-4286-4e9a-b9cb-aa31262b596a");
    assert_eq!(jinnie.layout, "reversible_card");
    assert!(
        jinnie.card_faces.is_some(),
        "the faces stay on the printing"
    );
    // Nothing else in the fixture shares this oracle id, so there is nothing
    // to fill the nulls from — see the test below for when there is.
    assert_eq!(jinnie.mana_cost, None);
}

/// Every printing in Default Cards resolves to an oracle id one way or the
/// other, so nothing in the fixture should be left without one.
#[tokio::test]
async fn every_printing_resolves_to_an_oracle_id() {
    let (pool, _) = seeded().await;

    let (missing,): (i64,) = sqlx::query_as("SELECT count(*) FROM cards WHERE oracle_id IS NULL")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(missing, 0);
}

#[tokio::test]
async fn colors_are_canonicalized_to_wubrg_order() {
    let (pool, _) = seeded().await;

    // Scryfall sends this one as ["B","R","U"].
    let admiral = row(&pool, "Admiral Beckett").await;
    assert_eq!(admiral.colors.as_deref(), Some("UBR"));
    assert_eq!(admiral.color_identity, "UBR");

    // The reversible printing carries no colors and nothing else in the
    // fixture shares its oracle id, so the card has none to inherit.
    assert_eq!(row(&pool, "Jinnie Fay").await.colors, None);
}

#[tokio::test]
async fn json_columns_are_queryable_as_json() {
    let (pool, _) = seeded().await;

    let (legal,): (String,) = sqlx::query_as(
        "SELECT json_extract(legalities.json, '$.commander')
         FROM cards
         JOIN legalities ON legalities.id = cards.legalities_id
         JOIN oracle ON oracle.id = cards.oracle_id
         WHERE oracle.name LIKE 'Admiral%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(legal, "legal");
}

async fn legality_rows(pool: &SqlitePool) -> i64 {
    let (rows,): (i64,) = sqlx::query_as("SELECT count(*) FROM legalities")
        .fetch_one(pool)
        .await
        .unwrap();
    rows
}

/// Two printings that share a legality combination must store it once — the
/// whole reason the column is a reference. The fixture's four cards each have
/// their own combination, so this reprints one under a new id.
#[tokio::test]
async fn identical_legalities_are_stored_once() {
    let pool = open_memory().await.unwrap();
    let card = CARDS.lines().next().unwrap();
    let mut reprint: serde_json::Value = serde_json::from_str(card).unwrap();
    reprint["id"] = serde_json::json!("00000000-0000-4000-8000-000000000001");
    reprint["collector_number"] = serde_json::json!("reprint");

    let ndjson = format!("{card}\n{reprint}\n");
    let report = cards::replace(&pool, &bulk("x"), &mut stream(ndjson))
        .await
        .unwrap();

    assert_eq!(report.written, 2);
    assert_eq!(legality_rows(&pool).await, 1);
}

/// A replace clears the lookup table too, so dead combinations don't pile up.
#[tokio::test]
async fn replacing_does_not_accumulate_legalities() {
    let (pool, _) = seeded().await;
    let before = legality_rows(&pool).await;
    assert_eq!(before, 4, "the four fixture cards differ in legality");

    cards::replace(
        &pool,
        &bulk("2026-09-07T00:00:00.000+00:00"),
        &mut stream(CARDS),
    )
    .await
    .unwrap();

    assert_eq!(legality_rows(&pool).await, before);
}

#[tokio::test]
async fn a_printing_is_found_by_set_number_and_language() {
    let (pool, _) = seeded().await;

    let (set_code, number, lang): (String, String, String) =
        sqlx::query_as("SELECT set_code, collector_number, lang FROM cards WHERE lang = 'ja'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let id = cards::printing_id(&pool, &set_code, &number, &lang)
        .await
        .unwrap();
    assert!(id.is_some());
    assert!(
        cards::printing_id(&pool, &set_code, &number, "en")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn search_finds_a_card_by_name_prefix() {
    let (pool, _) = seeded().await;

    let hits = cards::search(
        &pool,
        "admiral beck",
        Search {
            limit: 10,
            ..Search::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0].name.starts_with("Admiral Beckett"));
}

#[tokio::test]
async fn search_finds_a_non_english_printing_by_its_printed_name() {
    let (pool, _) = seeded().await;

    let hits = cards::search(
        &pool,
        "暴虐",
        Search {
            limit: 10,
            ..Search::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(
        hits[0].lang, "ja",
        "the Japanese printing is its own card's only one"
    );
}

/// User input reaches FTS5, which has its own query syntax.
#[tokio::test]
async fn search_treats_fts_syntax_as_text() {
    let (pool, _) = seeded().await;

    for query in ["\"", "admiral OR NOT", "a*(b)", "^admiral", ""] {
        cards::search(
            &pool,
            query,
            Search {
                limit: 10,
                ..Search::default()
            },
        )
        .await
        .unwrap_or_else(|error| panic!("{query:?} should not error: {error}"));
    }
}

#[tokio::test]
async fn an_empty_stream_leaves_the_previous_catalog_alone() {
    let (pool, _) = seeded().await;

    let error = cards::replace(
        &pool,
        &bulk("2026-09-07T00:00:00.000+00:00"),
        &mut stream(""),
    )
    .await
    .expect_err("an empty stream should be refused");

    assert!(matches!(error, Error::EmptySync), "got {error:?}");
    assert_eq!(cards::count(&pool).await.unwrap(), 4, "cache was emptied");
    assert_eq!(
        cards::last_synced(&pool, "default_cards")
            .await
            .unwrap()
            .as_deref(),
        Some("2026-09-06T21:05:43.673+00:00"),
        "the refused sync recorded itself",
    );
}

#[tokio::test]
async fn replacing_does_not_accumulate() {
    let (pool, _) = seeded().await;

    let report = cards::replace(
        &pool,
        &bulk("2026-09-07T00:00:00.000+00:00"),
        &mut stream(CARDS),
    )
    .await
    .unwrap();

    assert_eq!(report.written, 4);
    assert_eq!(cards::count(&pool).await.unwrap(), 4);
    assert_eq!(
        cards::search(
            &pool,
            "admiral",
            Search {
                limit: 10,
                ..Search::default()
            }
        )
        .await
        .unwrap()
        .len(),
        1
    );
}

#[tokio::test]
async fn a_bad_line_is_skipped_and_counted() {
    let pool = open_memory().await.unwrap();
    let ndjson = format!("{}\nnot json\n", CARDS.lines().next().unwrap());

    let report = cards::replace(&pool, &bulk("x"), &mut stream(ndjson))
        .await
        .unwrap();

    assert_eq!(
        report,
        SyncReport {
            written: 1,
            cards: 1,
            skipped: 1
        }
    );
    assert_eq!(cards::count(&pool).await.unwrap(), 1);
}

/// Builds a stream from the fixture's first card plus mutated copies of it, so
/// ranking and grouping can be exercised without a second fixture.
fn variants(mutations: &[&[(&str, serde_json::Value)]]) -> String {
    variants_of(0, mutations)
}

fn variants_of(line: usize, mutations: &[&[(&str, serde_json::Value)]]) -> String {
    let base: serde_json::Value =
        serde_json::from_str(CARDS.lines().nth(line).unwrap()).expect("fixture parses");
    let mut out = base.to_string();
    for (n, muts) in mutations.iter().enumerate() {
        let mut card = base.clone();
        card["id"] = serde_json::json!(format!("00000000-0000-4000-8000-{n:012}"));
        card["collector_number"] = serde_json::json!(format!("v{n}"));
        for (key, value) in *muts {
            card[*key] = value.clone();
        }
        out.push('\n');
        out.push_str(&card.to_string());
    }
    out.push('\n');
    out
}

async fn seeded_with(ndjson: String) -> SqlitePool {
    let pool = open_memory().await.unwrap();
    cards::replace(&pool, &bulk("x"), &mut stream(ndjson))
        .await
        .expect("variants should sync");
    pool
}

#[tokio::test]
async fn grouping_collapses_printings_of_one_card() {
    // Same oracle_id, so the two are printings of one card.
    let pool = seeded_with(variants(&[&[]])).await;

    let grouped = cards::search(&pool, "admiral", Search::default())
        .await
        .unwrap();
    assert_eq!(grouped.len(), 1, "two printings, one card");
    assert_eq!(grouped[0].printings, 2, "and it says how many");

    let all = cards::search(
        &pool,
        "admiral",
        Search {
            group_printings: false,
            ..Search::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn cards_rank_above_tokens_above_art_series() {
    let pool = seeded_with(variants(&[
        &[
            ("layout", serde_json::json!("token")),
            (
                "oracle_id",
                serde_json::json!("11111111-1111-4111-8111-111111111111"),
            ),
        ],
        &[
            ("layout", serde_json::json!("art_series")),
            (
                "oracle_id",
                serde_json::json!("22222222-2222-4222-8222-222222222222"),
            ),
        ],
    ]))
    .await;

    let hits = cards::search(&pool, "admiral", Search::default())
        .await
        .unwrap();
    let layouts: Vec<&str> = hits.iter().map(|h| h.layout.as_str()).collect();
    assert_eq!(layouts, ["normal", "token", "art_series"]);
}

#[tokio::test]
async fn tokens_and_art_series_can_each_be_hidden() {
    let pool = seeded_with(variants(&[
        &[
            ("layout", serde_json::json!("token")),
            (
                "oracle_id",
                serde_json::json!("11111111-1111-4111-8111-111111111111"),
            ),
        ],
        &[
            ("layout", serde_json::json!("art_series")),
            (
                "oracle_id",
                serde_json::json!("22222222-2222-4222-8222-222222222222"),
            ),
        ],
    ]))
    .await;

    let without = |tokens, art_series| Search {
        tokens,
        art_series,
        ..Search::default()
    };
    let layouts =
        |hits: Vec<cards::CardBrief>| hits.into_iter().map(|h| h.layout).collect::<Vec<_>>();

    assert_eq!(
        layouts(
            cards::search(&pool, "admiral", without(false, true))
                .await
                .unwrap()
        ),
        ["normal", "art_series"]
    );
    assert_eq!(
        layouts(
            cards::search(&pool, "admiral", without(true, false))
                .await
                .unwrap()
        ),
        ["normal", "token"]
    );
    assert_eq!(
        layouts(
            cards::search(&pool, "admiral", without(false, false))
                .await
                .unwrap()
        ),
        ["normal"]
    );
}

/// A paper collection can't hold an Arena-only printing, so no toggle reaches
/// them.
#[tokio::test]
async fn digital_printings_never_surface() {
    let pool = seeded_with(variants(&[&[
        ("digital", serde_json::json!(true)),
        (
            "oracle_id",
            serde_json::json!("33333333-3333-4333-8333-333333333333"),
        ),
    ]]))
    .await;

    for opts in [
        Search::default(),
        Search {
            group_printings: false,
            ..Search::default()
        },
    ] {
        let hits = cards::search(&pool, "admiral", opts).await.unwrap();
        assert_eq!(hits.len(), 1, "only the paper printing");
        assert_eq!(hits[0].layout, "normal");
    }
}

/// An exact name match wins the tier.
#[tokio::test]
async fn an_exact_name_match_outranks_its_tier() {
    let pool = seeded_with(variants(&[&[
        ("layout", serde_json::json!("token")),
        ("name", serde_json::json!("Admiral")),
        (
            "oracle_id",
            serde_json::json!("44444444-4444-4444-8444-444444444444"),
        ),
    ]]))
    .await;

    let hits = cards::search(&pool, "Admiral", Search::default())
        .await
        .unwrap();
    assert_eq!(hits[0].name, "Admiral", "the token is named exactly that");
    assert_eq!(hits[0].layout, "token");
}

/// The repair the split buys: a reversible printing carries none of its own
/// gameplay data, and takes it from another printing of the same card.
#[tokio::test]
async fn a_reversible_printing_inherits_gameplay_data_from_a_normal_one() {
    // The fixture's Jinnie Fay is reversible-only; give it a normal printing.
    let pool = seeded_with(variants_of(
        1,
        &[&[
            ("layout", serde_json::json!("normal")),
            ("mana_cost", serde_json::json!("{R/G}{G}{G/W}")),
            (
                "type_line",
                serde_json::json!("Legendary Creature — Elf Druid"),
            ),
            ("colors", serde_json::json!(["G", "R", "W"])),
        ]],
    ))
    .await;

    let jinnie = row(&pool, "Jinnie Fay").await;
    assert_eq!(jinnie.mana_cost.as_deref(), Some("{R/G}{G}{G/W}"));
    assert_eq!(jinnie.colors.as_deref(), Some("WRG"));

    // Both printings are still there, under one card.
    assert_eq!(cards::count(&pool).await.unwrap(), 2);
    let hits = cards::search(&pool, "Jinnie", Search::default())
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].printings, 2);
}

/// The same repair with the printings the other way round. The faceless one
/// ranks better, so it displaces what the first printing established and the
/// merge has to fold that back in.
#[tokio::test]
async fn gameplay_data_survives_a_better_ranked_faceless_printing() {
    let faceless: serde_json::Value =
        serde_json::from_str(CARDS.lines().nth(1).unwrap()).expect("fixture parses");

    let mut normal = faceless.clone();
    normal["id"] = serde_json::json!("00000000-0000-4000-8000-000000000000");
    normal["collector_number"] = serde_json::json!("v0");
    normal["layout"] = serde_json::json!("normal");
    normal["type_line"] = serde_json::json!("Legendary Creature — Elf Druid");
    normal["mana_cost"] = serde_json::json!("{R/G}{G}{G/W}");

    // A booster expansion outranks the box set the fixture printing came from.
    let mut better = faceless;
    better["set_type"] = serde_json::json!("expansion");
    better["booster"] = serde_json::json!(true);

    let pool = seeded_with(format!("{normal}\n{better}\n")).await;

    let jinnie = row(&pool, "Jinnie Fay").await;
    assert_eq!(jinnie.mana_cost.as_deref(), Some("{R/G}{G}{G/W}"));
    assert_eq!(
        jinnie.type_line.as_deref(),
        Some("Legendary Creature — Elf Druid")
    );
    assert_eq!(cards::count(&pool).await.unwrap(), 2);
}

#[tokio::test]
async fn a_printing_carries_the_artwork_it_shows() {
    let (pool, _) = seeded().await;

    let (held,): (String,) = sqlx::query_as(
        "SELECT illustration_id FROM cards WHERE set_code = 'plst' AND collector_number = 'XLN-217'",
    )
    .fetch_one(&pool)
    .await
    .expect("the multicolor printing should be there");

    assert_eq!(held, "8590b2be-8a63-4221-a043-d6b40fd2bc91");
}

#[tokio::test]
async fn a_two_faced_printing_takes_the_artwork_of_its_front() {
    let (pool, _) = seeded().await;

    // Neither layout carries one at the top level, and a scanner is looking at
    // the face in front of it.
    let held: Vec<(String,)> = sqlx::query_as(
        "SELECT illustration_id FROM cards
         WHERE layout IN ('reversible_card', 'transform') ORDER BY layout",
    )
    .fetch_all(&pool)
    .await
    .expect("both layouts should be there");

    let held: Vec<&str> = held.iter().map(|(id,)| id.as_str()).collect();
    assert_eq!(
        held,
        [
            "6b8fb6bb-c0d1-4715-a4df-e4f4695c6130", // reversible_card
            "83559f92-ec25-4f3e-8f67-a66970c1e01e", // transform
        ]
    );
}
