//! The catalog artifact, built from the same printings as `cache.rs`.

use std::io::Cursor;

use manaweb_core::{Error, cards, catalog, open_memory};
use manaweb_scanner::HASHES;
use manaweb_scanner::store::{Store, uuid};
use manaweb_scryfall::{BulkData, CardStream};
use serde_json::Value;
use sqlx::SqlitePool;

const CARDS: &str = include_str!("fixtures/cards.jsonl");

/// Two printings of Urza's Tower in 9ED that tie on set, type, booster and
/// release date, foil-only first as the file has it.
const FOIL_TWIN: &str = include_str!("fixtures/foil-twin.jsonl");

/// The fields most cards don't carry: Jace Beleren has loyalty and no power,
/// and Gaea's Cradle is on the reserved list and a game changer.
const SPARSE: &str = include_str!("fixtures/sparse.jsonl");

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

async fn seeded_with(ndjson: &str) -> SqlitePool {
    let pool = open_memory().await.expect("migrations should apply");
    cards::replace(
        &pool,
        &bulk("2026-09-06T21:05:43.673+00:00"),
        &mut CardStream::new(Cursor::new(ndjson.as_bytes().to_vec())),
    )
    .await
    .expect("fixture should sync");
    pool
}

fn read(json: &[u8]) -> Value {
    serde_json::from_slice(json).expect("the artifact should be JSON")
}

fn rows(file: &Value, key: &str) -> Vec<Vec<Value>> {
    file[key]
        .as_array()
        .expect("rows should be an array")
        .iter()
        .map(|row| row.as_array().expect("a row is an array").clone())
        .collect()
}

#[tokio::test]
async fn an_unsynced_cache_has_no_catalog() {
    let pool = open_memory().await.unwrap();
    assert!(matches!(
        catalog::build(&pool, None).await,
        Err(Error::EmptyCatalog)
    ));
}

/// Refusing beats publishing over a correct artifact with whatever the
/// migration left empty.
#[tokio::test]
async fn a_cache_from_before_a_migration_has_no_catalog() {
    let pool = seeded_with(CARDS).await;
    sqlx::query("UPDATE bulk_sync SET schema_version = schema_version - 1")
        .execute(&pool)
        .await
        .expect("the sync should have recorded a schema");

    assert!(matches!(
        catalog::build(&pool, None).await,
        Err(Error::EmptyCatalog)
    ));
}

/// Both files say what their columns are, so nothing has to read this crate to
/// interpret one.
#[tokio::test]
async fn each_file_names_its_own_columns() {
    let pool = seeded_with(CARDS).await;
    let built = catalog::build(&pool, None).await.unwrap();

    for (artifact, key) in [(&built.cards, "cards"), (&built.prints, "prints")] {
        let file = read(&artifact.bytes);
        assert_eq!(file["version"], built.version);

        let fields = file["fields"].as_array().expect("fields should be listed");
        for row in rows(&file, key) {
            assert_eq!(
                row.len(),
                fields.len(),
                "{key} row is not as wide as fields"
            );
        }
    }
}

/// The run each card's printings sit in, which the client walks by position.
#[tokio::test]
async fn printings_group_into_the_runs_the_cards_claim() {
    let pool = seeded_with(CARDS).await;
    let built = catalog::build(&pool, None).await.unwrap();
    let cards = rows(&read(&built.cards.bytes), "cards");
    let prints = rows(&read(&built.prints.bytes), "prints");

    let mut offset = 0;
    for card in &cards {
        let count = card[8].as_u64().expect("printings is a count");
        let run = &prints[offset..offset + usize::try_from(count).unwrap()];

        // The representative printing is the one search shows for the card.
        let (default_print,): (String,) =
            sqlx::query_as("SELECT default_print FROM oracle WHERE id = ?")
                .bind(card[0].as_str().unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(run[0][0], default_print, "{} leads with", card[1]);

        offset += usize::try_from(count).unwrap();
    }
    assert_eq!(offset, prints.len(), "every printing belongs to a run");
}

#[tokio::test]
async fn a_digital_printing_is_left_out() {
    let paper = CARDS.lines().next().unwrap();
    let mut digital: Value = serde_json::from_str(paper).unwrap();
    digital["id"] = serde_json::json!("00000000-0000-4000-8000-000000000000");
    digital["collector_number"] = serde_json::json!("d1");
    digital["digital"] = serde_json::json!(true);

    let pool = seeded_with(&format!("{paper}\n{digital}\n")).await;
    let built = catalog::build(&pool, None).await.unwrap();

    assert_eq!(cards::count(&pool).await.unwrap(), 2, "both are cached");
    assert_eq!(built.prints.rows, 1, "only the paper one is published");
}

/// Names carry a hash of the bytes, which is what lets a response claim to be
/// immutable.
#[tokio::test]
async fn a_file_is_named_after_its_contents() {
    let same = catalog::build(&seeded_with(CARDS).await, None)
        .await
        .unwrap();
    let again = catalog::build(&seeded_with(CARDS).await, None)
        .await
        .unwrap();
    assert_eq!(same.cards.name, again.cards.name);

    let fewer = catalog::build(&seeded_with(CARDS.lines().next().unwrap()).await, None)
        .await
        .unwrap();
    assert_ne!(same.cards.name, fewer.cards.name);
}

/// Printings that tie on everything else still come out in one order, and the
/// ordinary printing leads.
#[tokio::test]
async fn an_ordinary_printing_outranks_its_foil_only_twin() {
    let built = catalog::build(&seeded_with(FOIL_TWIN).await, None)
        .await
        .unwrap();
    let file = read(&built.prints.bytes);
    let prints = rows(&file, "prints");
    let numbers: Vec<&str> = prints
        .iter()
        .map(|row| row[2].as_str().expect("a collector number"))
        .collect();

    assert_eq!(numbers, ["329", "329\u{2605}"]);
    assert_eq!(rows(&read(&built.cards.bytes), "cards").len(), 1);
}

/// Power and toughness, loyalty and defense print in the same corner and never
/// co-occur, so they share one column rather than spending three `null`s a row.
#[tokio::test]
async fn one_column_carries_power_loyalty_or_defense() {
    let pool = seeded_with(SPARSE).await;
    let built = catalog::build(&pool, None).await.unwrap();
    let file = read(&built.cards.bytes);

    for row in rows(&file, "cards") {
        let (power, toughness, loyalty): (Option<String>, Option<String>, Option<String>) =
            sqlx::query_as("SELECT power, toughness, loyalty FROM oracle WHERE id = ?")
                .bind(row[0].as_str().unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();

        let expected = match (power, toughness, loyalty) {
            (Some(power), Some(toughness), _) => Some(format!("{power}/{toughness}")),
            (_, _, loyalty) => loyalty,
        };
        assert_eq!(row[10].as_str().map(str::to_owned), expected, "{}", row[1]);
    }
}

/// Heading a deck needs the oracle text, which the client never sees, so the
/// bit is set here.
#[tokio::test]
async fn a_legendary_creature_is_flagged_as_a_commander() {
    let built = catalog::build(&seeded_with(CARDS).await, None)
        .await
        .unwrap();
    let file = read(&built.cards.bytes);
    let names: Vec<String> = serde_json::from_value(file["flags"].clone()).unwrap();
    let bit = 1 << names.iter().position(|one| one == "commander").unwrap();

    let flags = |name: &str| {
        rows(&file, "cards")
            .into_iter()
            .find(|row| row[1] == name)
            .unwrap_or_else(|| panic!("the fixture holds {name}"))[11]
            .as_u64()
            .unwrap()
    };

    assert_eq!(flags("Admiral Beckett Brass") & bit, bit);
    // A legend on the back of a land is not one, the front being what is cast.
    assert_eq!(
        flags("Balamb Garden, SeeD Academy // Balamb Garden, Airborne") & bit,
        0,
    );
}

/// Flags are a bitmask over the file's own `flags` list, on both files.
#[tokio::test]
async fn flags_survive_as_a_bitmask() {
    let built = catalog::build(&seeded_with(SPARSE).await, None)
        .await
        .unwrap();
    let file = read(&built.cards.bytes);
    let names: Vec<String> = serde_json::from_value(file["flags"].clone()).unwrap();
    assert_eq!(names, ["reserved", "gameChanger", "commander"]);

    let cradle = rows(&file, "cards")
        .into_iter()
        .find(|row| row[1] == "Gaea's Cradle")
        .expect("the fixture holds it");
    assert_eq!(cradle[11].as_u64(), Some(0b11));

    let prints = read(&built.prints.bytes);
    let flags: Vec<String> = serde_json::from_value(prints["flags"].clone()).unwrap();
    assert_eq!(
        flags,
        ["promo", "variation", "fullArt", "textless", "oversized"]
    );
}

/// Finishes are a bitmask over the file's own `finishes` list.
#[tokio::test]
async fn finishes_survive_as_a_bitmask() {
    let pool = seeded_with(CARDS).await;
    let built = catalog::build(&pool, None).await.unwrap();
    let file = read(&built.prints.bytes);
    let names: Vec<String> = serde_json::from_value(file["finishes"].clone()).unwrap();

    for row in rows(&file, "prints") {
        let mask = row[3].as_u64().expect("a mask");
        let decoded: Vec<&String> = names
            .iter()
            .enumerate()
            .filter(|(bit, _)| mask & (1 << bit) != 0)
            .map(|(_, name)| name)
            .collect();

        let (json,): (String,) = sqlx::query_as("SELECT finishes FROM cards WHERE id = ?")
            .bind(row[0].as_str().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        let expected: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, expected.iter().collect::<Vec<_>>());
    }
}

/// The manifest names its files relative to itself, so the catalog can be
/// served from any origin without the format changing.
#[tokio::test]
async fn the_manifest_names_files_that_sit_beside_it() {
    let pool = seeded_with(CARDS).await;
    let built = catalog::build(&pool, None).await.unwrap();

    let dir = std::env::temp_dir().join(format!("manaweb-write-{}", std::process::id()));
    built.write(&dir).await.unwrap();

    let manifest: Value =
        serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["version"], built.version);

    for kind in ["cards", "prints"] {
        let entry = &manifest[kind];
        assert!(
            entry.get("path").is_none(),
            "{kind} carries an absolute path, which pins it to one origin"
        );

        let name = entry["name"].as_str().unwrap();
        assert!(dir.join(name).is_file(), "{name} was not written");
    }

    std::fs::remove_dir_all(dir).unwrap();
}

/// The order is written at sync and sorted on here, so a cache that somehow
/// holds rows without it would write them in whatever order the table has.
#[tokio::test]
async fn a_cache_with_no_order_written_is_refused() {
    let pool = seeded_with(CARDS).await;
    sqlx::query("UPDATE cards SET seq = NULL")
        .execute(&pool)
        .await
        .expect("the column should be there to clear");

    assert!(matches!(
        catalog::build(&pool, None).await,
        Err(Error::CatalogOrder)
    ));
}

/// The scanner matches art and then picks among whatever shares it, so what
/// the column has to carry is sameness, not which artwork it is.
#[tokio::test]
async fn printings_of_one_artwork_share_a_group() {
    let built = catalog::build(&seeded_with(FOIL_TWIN).await, None)
        .await
        .unwrap();
    let file = read(&built.prints.bytes);

    let prints = rows(&file, "prints");
    let art: Vec<&Value> = prints.iter().map(|row| &row[11]).collect();

    assert_eq!(art, [&Value::from(0), &Value::from(0)]);
}

/// Every other layout carries one, so a null here is Scryfall's omission
/// rather than a column the export forgot to fill.
#[tokio::test]
async fn a_printing_with_no_artwork_says_so() {
    let built = catalog::build(&seeded_with(CARDS).await, None)
        .await
        .unwrap();
    let file = read(&built.prints.bytes);
    let fields = file["fields"].as_array().expect("a field list");

    assert_eq!(fields.last().expect("a last field"), "artwork");
    assert!(
        rows(&file, "prints")
            .iter()
            .all(|row| row[11].is_number() || row[11].is_null())
    );
}

/// Commonest first, so the words a card is likeliest to carry index smallest.
#[tokio::test]
async fn keywords_are_indexes_into_a_table_of_them() {
    let built = catalog::build(&seeded_with(CARDS).await, None)
        .await
        .unwrap();
    let file = read(&built.cards.bytes);

    let table: Vec<&str> = file["keywords"]
        .as_array()
        .expect("a keyword table")
        .iter()
        .map(|word| word.as_str().expect("a word"))
        .collect();
    assert_eq!(table[0], "Flying", "two cards fly, one crews");

    let named: Vec<Vec<&str>> = rows(&file, "cards")
        .iter()
        .map(|row| {
            row[12]
                .as_array()
                .expect("a list, empty where a card has none")
                .iter()
                .map(|at| table[usize::try_from(at.as_u64().expect("an index")).unwrap()])
                .collect()
        })
        .collect();

    assert_eq!(
        named,
        [
            vec![] as Vec<&str>,
            vec!["Flying", "Transform", "Crew"],
            vec![],
            vec!["Flying"],
        ],
        "by name: Admiral, Balamb Garden, Jinnie Fay, Vaevictis"
    );
}

/// A two-sided card's own columns are its sides combined or empty, so the
/// faces are what answers for either one.
#[tokio::test]
async fn a_two_faced_card_carries_a_row_for_each_side() {
    let built = catalog::build(&seeded_with(CARDS).await, None)
        .await
        .unwrap();
    let file = read(&built.cards.bytes);

    assert_eq!(
        file["faceFields"],
        serde_json::json!(["name", "typeLine", "manaCost", "colors", "stats"])
    );

    // By name: Admiral, Balamb Garden, Jinnie Fay, Vaevictis.
    let cards = rows(&file, "cards");
    let sides: Vec<usize> = cards
        .iter()
        .map(|row| row[13].as_array().map_or(0, Vec::len))
        .collect();
    assert_eq!(sides, [0, 2, 2, 0], "only the two faced cards carry any");

    assert_eq!(
        cards[1][13],
        serde_json::json!([
            ["Balamb Garden, SeeD Academy", "Land — Town", "", 0, null],
            [
                "Balamb Garden, Airborne",
                "Legendary Artifact — Vehicle",
                "",
                0,
                "5/4"
            ],
        ]),
        "the transform card, whose own colors and stats are null"
    );
}

/// The artwork on the front of each printing in `cards.jsonl`, by printing.
const ARTWORKS: [(&str, &str); 4] = [
    (
        "0004311b-646a-4df8-a4b4-9171642e9ef4",
        "8590b2be-8a63-4221-a043-d6b40fd2bc91",
    ),
    (
        "018830b2-dff9-45f3-9cc2-dc5b2eec0e54",
        "6b8fb6bb-c0d1-4715-a4df-e4f4695c6130",
    ),
    (
        "001e9f20-5b15-41cb-bf82-46172decc235",
        "83559f92-ec25-4f3e-8f67-a66970c1e01e",
    ),
    (
        "00177fcf-92af-475a-a7f5-11ab645388a5",
        "a770a481-3210-4b60-8308-5afcb3f17a22",
    ),
];

/// The two backs it carries, each against the front it shares a printing
/// with: Jinnie Fay and Balamb Garden.
const BACKS: [(&str, &str); 2] = [
    (
        "faebc2ac-9b6e-477d-869e-cee314d26cc0",
        "6b8fb6bb-c0d1-4715-a4df-e4f4695c6130",
    ),
    (
        "dd3fc1d7-6e7c-4b10-a4b5-8dc0804061e1",
        "83559f92-ec25-4f3e-8f67-a66970c1e01e",
    ),
];

fn fronts() -> Vec<&'static str> {
    ARTWORKS.iter().map(|(_, artwork)| *artwork).collect()
}

/// Every artwork the fixture carries, front and back.
fn everything() -> Vec<&'static str> {
    let mut all = fronts();
    all.extend(BACKS.iter().map(|(back, _)| *back));
    all
}

fn store(artworks: &[&str]) -> Store {
    let mut store = Store::new();
    for (at, artwork) in artworks.iter().enumerate() {
        let at = u64::try_from(at).expect("a small index");
        store.insert(
            uuid(artwork).expect("a uuid"),
            std::array::from_fn(|hash| at * 100 + u64::try_from(hash).expect("a small index") + 1),
        );
    }
    store
}

/// The index as a client takes it.
struct Part {
    header: Value,
    /// The hashes, `HASHES` to an artwork, where they lie in the file.
    words: Vec<u64>,
    /// A bit per artwork: whether the store answered for it.
    held: Vec<u8>,
    /// Each back artwork against the front it shares a printing with.
    pairs: Vec<(u32, u32)>,
}

impl Part {
    fn read(bytes: &[u8]) -> Self {
        let at = bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .expect("a header");
        let header: Value =
            serde_json::from_slice(&bytes[..at]).expect("the header should be JSON");
        let count = |key: &str| {
            usize::try_from(header[key].as_u64().expect("a count")).expect("a small count")
        };

        let from = at + 1;
        let to = from + count("rows") * count("hashes") * size_of::<u64>();
        let words = bytes[from..to]
            .as_chunks::<{ size_of::<u64>() }>()
            .0
            .iter()
            .map(|word| u64::from_le_bytes(*word))
            .collect();

        let bits = to + count("backs") * 2 * size_of::<u32>();
        let pairs = bytes[to..bits]
            .as_chunks::<{ 2 * size_of::<u32>() }>()
            .0
            .iter()
            .map(|pair| {
                let (back, front) = pair.split_at(size_of::<u32>());
                (
                    u32::from_le_bytes(back.try_into().expect("four bytes")),
                    u32::from_le_bytes(front.try_into().expect("four bytes")),
                )
            })
            .collect();

        Self {
            header,
            words,
            held: bytes[bits..].to_vec(),
            pairs,
        }
    }

    fn count(&self, key: &str) -> usize {
        usize::try_from(self.header[key].as_u64().expect("a count")).expect("a small count")
    }

    /// Whether the store answered for the artwork numbered `at`.
    fn answered(&self, at: usize) -> bool {
        self.held[at / 8] & (1 << (at % 8)) != 0
    }

    fn hashes(&self, at: usize) -> &[u64] {
        &self.words[at * HASHES..(at + 1) * HASHES]
    }
}

async fn built(artworks: &[&str]) -> manaweb_core::catalog::Catalog {
    catalog::build(&seeded_with(CARDS).await, Some(&store(artworks)))
        .await
        .unwrap()
}

#[tokio::test]
async fn an_export_given_no_hashes_still_publishes_the_pair() {
    let built = catalog::build(&seeded_with(CARDS).await, None)
        .await
        .unwrap();

    assert!(built.artwork.is_none());
    assert!(read(&built.manifest().unwrap()).get("artwork").is_none());
}

// The index is read by position, so an entry missing anywhere in it would
// shift every artwork after that one onto the wrong card.
#[tokio::test]
async fn the_index_holds_every_art_number_the_printings_name() {
    let built = built(&everything()).await;
    let index = built.artwork.as_ref().expect("an index");
    let part = Part::read(&index.bytes);

    let most = rows(&read(&built.prints.bytes), "prints")
        .iter()
        .filter_map(|row| row[11].as_u64())
        .max()
        .expect("a printing carrying an artwork");

    assert_eq!(part.count("fronts"), usize::try_from(most + 1).unwrap());
    assert_eq!(part.count("rows"), index.rows);
    assert_eq!(part.words.len(), index.rows * HASHES);
    assert_eq!(part.count("absent"), 0);
    assert!((0..index.rows).all(|at| part.answered(at)));
}

// The whole part is positional, so hashes in the file in any order at all
// would satisfy a test that only asks whether they are in it.
#[tokio::test]
async fn an_artwork_sits_at_the_number_the_printings_give_it() {
    let held = store(&everything());
    let built = catalog::build(&seeded_with(CARDS).await, Some(&held))
        .await
        .unwrap();
    let part = Part::read(&built.artwork.as_ref().expect("an index").bytes);

    let mut checked = 0;
    for row in rows(&read(&built.prints.bytes), "prints") {
        let print = row[0].as_str().expect("a printing id");
        let Some(at) = row[11].as_u64() else { continue };
        let at = usize::try_from(at).expect("a small index");

        let (_, artwork) = ARTWORKS
            .iter()
            .find(|(held, _)| *held == print)
            .expect("a printing the fixture names");
        let mine = held.get(&uuid(artwork).expect("a uuid")).expect("hashes");

        assert_eq!(part.hashes(at), mine, "{print}");
        checked += 1;
    }
    assert_eq!(checked, ARTWORKS.len());
}

// A back that is nothing else takes a number past every front, so no column
// of the printings file names it. `CARDS` carries no artwork that is both.
#[tokio::test]
async fn a_back_of_its_own_is_numbered_after_every_front() {
    let built = built(&everything()).await;
    let part = Part::read(&built.artwork.as_ref().expect("an index").bytes);

    assert_eq!(part.count("backs"), BACKS.len());
    assert_eq!(part.count("rows"), part.count("fronts") + BACKS.len());
    for (back, _) in &part.pairs {
        assert!(usize::try_from(*back).unwrap() >= part.count("fronts"));
    }
}

// An artwork that is also a front keeps the number it had, so what must hold
// either way is that a pair's front is one the printings name.
#[tokio::test]
async fn a_pair_points_where_the_printings_file_can_follow() {
    for cards in [CARDS, SHARED_ART] {
        let built = catalog::build(&seeded_with(cards).await, Some(&store(&everything())))
            .await
            .unwrap();
        let index = built.artwork.as_ref().expect("an index");
        let part = Part::read(&index.bytes);

        assert!(!part.pairs.is_empty());
        for (back, front) in &part.pairs {
            assert!(usize::try_from(*front).unwrap() < part.count("fronts"));
            assert!(usize::try_from(*back).unwrap() < index.rows);
        }
    }
}

/// Ten printings, ten artworks, so the bitmap runs past its first byte.
const MANY_ART: &str = include_str!("fixtures/many-art.jsonl");

// Every other test holds eight artworks or fewer, which is one byte, so the
// bit a client reads and the bit written here agree by accident.
#[tokio::test]
async fn the_bitmap_says_which_artwork_across_more_than_one_byte() {
    let ids: Vec<String> = (0..10)
        .map(|n| format!("{n:08x}-3333-4444-8555-666666666666"))
        .collect();
    // Straddling the byte boundary in both directions.
    let some: Vec<&str> = [0usize, 3, 7, 8, 9]
        .iter()
        .map(|at| ids[*at].as_str())
        .collect();

    let built = catalog::build(&seeded_with(MANY_ART).await, Some(&store(&some)))
        .await
        .unwrap();
    let index = built.artwork.as_ref().expect("an index");
    let part = Part::read(&index.bytes);

    assert_eq!(index.rows, 10);
    assert_eq!(part.held.len(), 2, "ten artworks is two bytes of bitmap");
    assert_eq!(part.count("absent"), 5);

    let mut seen = 0;
    for row in rows(&read(&built.prints.bytes), "prints") {
        let at = usize::try_from(row[11].as_u64().expect("an artwork")).unwrap();
        let zeroed = part.hashes(at).iter().all(|word| *word == 0);
        assert_ne!(zeroed, part.answered(at), "artwork {at}");
        seen += 1;
    }
    assert_eq!(seen, 10);
    assert_eq!((0..10).filter(|at| part.answered(*at)).count(), some.len());
}

/// One printing two-faced, and one whose own artwork is that printing's back.
const SHARED_ART: &str = include_str!("fixtures/shared-art.jsonl");

// Numbering a shared artwork twice would hash it twice and leave a pair
// pointing at the copy — 86 in a real sync.
#[tokio::test]
async fn an_artwork_that_is_a_front_and_a_back_is_numbered_once() {
    let held = store(&[
        "83559f92-ec25-4f3e-8f67-a66970c1e01e",
        "dd3fc1d7-6e7c-4b10-a4b5-8dc0804061e1",
    ]);
    let built = catalog::build(&seeded_with(SHARED_ART).await, Some(&held))
        .await
        .unwrap();
    let index = built.artwork.as_ref().expect("an index");
    let part = Part::read(&index.bytes);

    assert_eq!(part.count("fronts"), 2, "both printings name an artwork");
    assert_eq!(index.rows, 2, "and the back is one of the two");
    assert_eq!(part.count("backs"), 1);

    let (back, front) = part.pairs[0];
    assert_ne!(back, front);
    let shared = held
        .get(&uuid("dd3fc1d7-6e7c-4b10-a4b5-8dc0804061e1").unwrap())
        .expect("hashes");
    assert_eq!(part.hashes(usize::try_from(back).unwrap()), shared);
}

// What the pair is for: a photograph of the other side resolving to the same
// printings as a photograph of this one.
#[tokio::test]
async fn a_back_pairs_with_the_front_it_shares_a_printing_with() {
    let held = store(&everything());
    let built = catalog::build(&seeded_with(CARDS).await, Some(&held))
        .await
        .unwrap();
    let part = Part::read(&built.artwork.as_ref().expect("an index").bytes);

    assert_eq!(part.pairs.len(), BACKS.len());
    for (back, front) in &BACKS {
        let want = held.get(&uuid(back).expect("a uuid")).expect("hashes");
        let (_, at) = part
            .pairs
            .iter()
            .find(|(back, _)| part.hashes(usize::try_from(*back).unwrap()) == want)
            .expect("a pair for the back");

        let theirs = held.get(&uuid(front).expect("a uuid")).expect("hashes");
        assert_eq!(part.hashes(usize::try_from(*at).unwrap()), theirs);
    }
}

// The store is pulled separately and lags a set release, so this is the
// ordinary case rather than the broken one.
#[tokio::test]
async fn an_artwork_the_store_has_nothing_for_has_its_bit_clear() {
    let mut some = everything();
    some.remove(0);
    let built = built(&some).await;
    let index = built.artwork.as_ref().expect("an index");
    let part = Part::read(&index.bytes);

    assert_eq!(
        index.rows,
        everything().len(),
        "an artwork with no hashes is still numbered"
    );
    assert_eq!(part.count("absent"), 1);

    let clear: Vec<usize> = (0..index.rows).filter(|at| !part.answered(*at)).collect();
    assert_eq!(clear.len(), 1);
    assert!(part.hashes(clear[0]).iter().all(|word| *word == 0));
}

// Pure black hashes to zero, so an artwork with no hashes would otherwise be
// the nearest match to a frame taken with the lens covered.
#[tokio::test]
async fn nothing_says_an_artwork_with_no_hashes_can_be_matched() {
    let mut some = everything();
    some.remove(0);
    let built = built(&some).await;
    let index = built.artwork.as_ref().expect("an index");
    let part = Part::read(&index.bytes);

    for at in 0..index.rows {
        let zeroed = part.hashes(at).iter().all(|word| *word == 0);
        assert_ne!(zeroed, part.answered(at), "artwork {at}");
    }
}

// A mismatched pair reads the wrong rows rather than failing, so every part
// repeats the version — see `docs/scryfall.md`.
#[tokio::test]
async fn the_index_names_the_version_the_pair_does() {
    let built = built(&everything()).await;
    let part = Part::read(&built.artwork.as_ref().expect("an index").bytes);

    assert_eq!(
        part.header["version"].as_str(),
        Some(built.version.as_str())
    );
    assert_eq!(part.count("hashes"), HASHES);
}

// A typed array of 64-bit words cannot start at an offset that is not a
// multiple of eight.
#[tokio::test]
async fn the_hashes_start_on_a_word_boundary() {
    let built = built(&everything()).await;
    let bytes = &built.artwork.as_ref().expect("an index").bytes;

    let at = bytes
        .iter()
        .position(|byte| *byte == b'\n')
        .expect("a header");
    assert!((at + 1).is_multiple_of(size_of::<u64>()));
}

// Everything the header counts, against the bytes that follow it.
#[tokio::test]
async fn the_file_is_exactly_as_long_as_the_header_claims() {
    let built = built(&everything()).await;
    let bytes = &built.artwork.as_ref().expect("an index").bytes;
    let part = Part::read(bytes);

    let at = bytes.iter().position(|byte| *byte == b'\n').unwrap() + 1;
    let want = at
        + part.count("rows") * HASHES * size_of::<u64>()
        + part.count("backs") * 2 * size_of::<u32>()
        + part.count("rows").div_ceil(8);
    assert_eq!(bytes.len(), want);

    // The pairs are read as words too, and the bitmap is whatever length the
    // artwork count makes it, so it cannot come first.
    let pairs = at + part.count("rows") * HASHES * size_of::<u64>();
    assert!(pairs.is_multiple_of(size_of::<u64>()));
}

#[tokio::test]
async fn the_manifest_names_the_index_when_there_is_one() {
    let built = built(&everything()).await;
    let manifest = read(&built.manifest().unwrap());
    let index = built.artwork.as_ref().expect("an index");

    assert_eq!(
        manifest["artwork"]["name"].as_str(),
        Some(index.name.as_str())
    );
    assert_eq!(
        manifest["artwork"]["rows"].as_u64(),
        Some(u64::try_from(index.rows).unwrap())
    );
    assert!(index.name.contains(".bin"), "{}", index.name);
}
