//! The catalog artifact: the slice of the cache a browser needs.
//!
//! Two files of positional rows, written uncompressed for a CDN to compress
//! and uploaded to object storage on their own origin, so nothing here knows a
//! URL. Which fields, and what they cost, is in `docs/scryfall.md`.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash as _, Hasher as _};
use std::io::Write as _;
use std::path::Path;

use futures_util::TryStreamExt as _;
use serde::Serialize;
use sqlx::SqlitePool;
use tokio::fs;

use crate::{Error, Result};

/// Bit `i` of a printing's `finishes` is this list's `i`th entry.
const FINISHES: [&str; 3] = ["nonfoil", "foil", "etched"];

/// `kind` on a card row indexes this. Search ranks in the same order.
const KINDS: [&str; 3] = ["card", "token", "artSeries"];

/// Bit `i` of a card's `colors` and `colorIdentity`, in the order the rules
/// name them.
const COLORS: [&str; 5] = ["W", "U", "B", "R", "G"];

/// Bit `i` of a card's `flags`. Rare enough to be worthless as columns, where
/// each would spend a `null` on all 37,000 rows to say something about 500.
///
/// `commander` is computed here because it needs the oracle text, which the
/// client artifact doesn't carry — one bit instead of a part. The two types
/// that head a deck are a rules fact rather than a derivation; a Spacecraft
/// says nothing about it and neither does a creature.
const CARD_FLAGS: [&str; 3] = ["reserved", "gameChanger", "commander"];

/// The same for a printing: what makes this copy of a card not the plain one.
const PRINT_FLAGS: [&str; 5] = ["promo", "variation", "fullArt", "textless", "oversized"];

const CARD_FIELDS: [&str; 12] = [
    "oracleId",
    "name",
    "typeLine",
    "manaCost",
    "cmc",
    "colors",
    "colorIdentity",
    "kind",
    "printings",
    "edhrecRank",
    "stats",
    "flags",
];

const PRINT_FIELDS: [&str; 11] = [
    "id",
    "set",
    "collectorNumber",
    "finishes",
    "rarity",
    "layout",
    "imageStatus",
    "lang",
    "printedName",
    "artist",
    "flags",
];

/// What the cards file says about itself before its rows.
#[derive(Debug, Serialize)]
struct CardHeader<'a> {
    version: &'a str,
    fields: [&'static str; 12],
    kinds: [&'static str; 3],
    colors: [&'static str; 5],
    flags: [&'static str; 3],
}

/// The same for printings, plus the tables its integer columns index into.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintHeader<'a> {
    version: &'a str,
    fields: [&'static str; 11],
    finishes: [&'static str; 3],
    flags: [&'static str; 5],
    rarities: &'a [String],
    layouts: &'a [String],
    image_statuses: &'a [String],
    langs: &'a [String],
    artists: &'a [String],
    sets: &'a [Set],
}

/// A set as the client lists it: code, name, kind, first release.
type Set = (String, String, String, String);

/// One file, named after its own content.
#[derive(Debug, Clone)]
pub struct Artifact {
    /// Filename with the hash in it, so a response can claim to be immutable.
    pub name: String,
    pub rows: usize,
    pub json: Vec<u8>,
}

impl Artifact {
    fn new(kind: &str, rows: usize, json: Vec<u8>) -> Self {
        // A cache key, not a signature, so a non-cryptographic hash is
        // enough — it only has to change when the bytes do.
        let mut hasher = DefaultHasher::new();
        json.hash(&mut hasher);
        let hash = format!("{:016x}", hasher.finish());
        Self {
            name: format!("{kind}.{hash}.json"),
            rows,
            json,
        }
    }
}

/// Both files, only ever published as a set: printings are grouped by card, in
/// the card array's order.
#[derive(Debug, Clone)]
pub struct Catalog {
    /// `updated_at` of the bulk file the cache was built from.
    pub version: String,
    pub cards: Artifact,
    pub prints: Artifact,
}

/// What a client fetches first: the paths of the current pair.
#[derive(Debug, Serialize)]
struct Manifest<'a> {
    version: &'a str,
    cards: Entry<'a>,
    prints: Entry<'a>,
}

#[derive(Debug, Serialize)]
struct Entry<'a> {
    /// Resolved against the manifest's own URL, so the catalog can move to
    /// another origin without the format changing.
    name: &'a str,
    rows: usize,
    bytes: usize,
}

impl<'a> Entry<'a> {
    fn new(artifact: &'a Artifact) -> Self {
        Self {
            name: &artifact.name,
            rows: artifact.rows,
            bytes: artifact.json.len(),
        }
    }
}

impl Catalog {
    /// The manifest naming the current pair, which is the only part of the
    /// artifact a client has to re-fetch.
    ///
    /// # Errors
    ///
    /// Fails only if the manifest won't serialize.
    pub fn manifest(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&Manifest {
            version: &self.version,
            cards: Entry::new(&self.cards),
            prints: Entry::new(&self.prints),
        })?)
    }

    /// Writes both files and the manifest under `dir`, ready to upload.
    ///
    /// Stale files are left in place. Uploading to object storage adds the new
    /// pair without removing the old one, so a client mid-load can still fetch
    /// what it was told about.
    ///
    /// # Errors
    ///
    /// Fails if the directory can't be created or a file can't be written.
    pub async fn write(&self, dir: impl AsRef<Path>) -> Result<()> {
        let dir = dir.as_ref();
        fs::create_dir_all(dir).await?;
        for artifact in [&self.cards, &self.prints] {
            fs::write(dir.join(&artifact.name), &artifact.json).await?;
        }
        fs::write(dir.join("manifest.json"), self.manifest()?).await?;
        Ok(())
    }
}

/// Builds both files from the cache.
///
/// # Errors
///
/// Fails on a database error, on a cache no sync has populated, or if the
/// printings don't group into the runs the card rows claim.
pub async fn build(pool: &SqlitePool) -> Result<Catalog> {
    let Some(version) = crate::cards::last_synced(pool, "default_cards").await? else {
        return Err(Error::EmptyCatalog);
    };

    let cards = build_cards(pool, &version).await?;
    let prints = build_prints(pool, &version).await?;

    let (claimed,): (i64,) =
        sqlx::query_as("SELECT coalesce(sum(printings), 0) FROM oracle WHERE paper")
            .fetch_one(pool)
            .await?;
    let claimed = usize::try_from(claimed).unwrap_or(usize::MAX);
    if claimed != prints.rows {
        // The client finds a card's printings by walking runs, so a mismatch
        // would silently shift every card past the first bad one.
        return Err(Error::CatalogRuns {
            claimed,
            written: prints.rows,
        });
    }

    Ok(Catalog {
        version,
        cards,
        prints,
    })
}

type CardRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<f64>,
    Option<i64>,
    i64,
    i64,
    i64,
    Option<i64>,
    Option<String>,
    i64,
);

async fn build_cards(pool: &SqlitePool, version: &str) -> Result<Artifact> {
    let mut out = Writer::new(
        &CardHeader {
            version,
            fields: CARD_FIELDS,
            kinds: KINDS,
            colors: COLORS,
            flags: CARD_FLAGS,
        },
        "cards",
    )?;

    let mut rows = sqlx::query_as::<_, CardRow>(
        // Power and toughness, loyalty and defense are mutually exclusive and
        // print in the same corner, so they share one column; the type line
        // says which it is.
        "SELECT id, name, type_line, mana_cost, cmc,
                CASE WHEN colors IS NULL THEN NULL ELSE
                    (instr(colors, 'W') > 0)
                    | ((instr(colors, 'U') > 0) << 1)
                    | ((instr(colors, 'B') > 0) << 2)
                    | ((instr(colors, 'R') > 0) << 3)
                    | ((instr(colors, 'G') > 0) << 4) END,
                  (instr(color_identity, 'W') > 0)
                | ((instr(color_identity, 'U') > 0) << 1)
                | ((instr(color_identity, 'B') > 0) << 2)
                | ((instr(color_identity, 'R') > 0) << 3)
                | ((instr(color_identity, 'G') > 0) << 4),
                kind, printings, edhrec_rank,
                CASE
                    WHEN power IS NOT NULL
                        THEN power || '/' || coalesce(toughness, '')
                    WHEN loyalty IS NOT NULL THEN loyalty
                    ELSE defense
                END,
                reserved | (coalesce(game_changer, 0) << 1)
                         | (CASE WHEN kind = 0 AND (
                                type_line LIKE 'Legendary%Creature%'
                                OR type_line LIKE 'Legendary%Spacecraft%'
                                OR oracle_text LIKE '%can be your commander%'
                            ) THEN 1 ELSE 0 END << 2)
         FROM oracle WHERE paper ORDER BY name, id",
    )
    .fetch(pool);

    let mut count = 0;
    while let Some(row) = rows.try_next().await? {
        out.row(&row)?;
        count += 1;
    }

    Ok(Artifact::new("cards", count, out.finish()?))
}

type PrintRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    i64,
);

async fn build_prints(pool: &SqlitePool, version: &str) -> Result<Artifact> {
    let sets: Vec<Set> = sqlx::query_as(
        "SELECT set_code, set_name, set_type, min(released_at)
         FROM cards WHERE NOT digital GROUP BY set_code ORDER BY set_code",
    )
    .fetch_all(pool)
    .await?;
    let set_index = index(sets.iter().map(|set| set.0.clone()));

    // 2,537 artists over 108,273 printings, so a table beats repeating them.
    // Scryfall sends an empty artist on 794 printings, which is no artist.
    let artists = common_first(pool, ARTISTS).await?;
    let artist_index = index(artists.iter().cloned());

    let rarities = common_first(pool, RARITIES).await?;
    let layouts = common_first(pool, LAYOUTS).await?;
    let statuses = common_first(pool, IMAGE_STATUSES).await?;
    let langs = common_first(pool, LANGS).await?;
    let (rarity_index, layout_index, status_index, lang_index) = (
        index(rarities.iter().cloned()),
        index(layouts.iter().cloned()),
        index(statuses.iter().cloned()),
        index(langs.iter().cloned()),
    );

    let mut out = Writer::new(
        &PrintHeader {
            version,
            fields: PRINT_FIELDS,
            finishes: FINISHES,
            rarities: &rarities,
            layouts: &layouts,
            flags: PRINT_FLAGS,
            image_statuses: &statuses,
            langs: &langs,
            artists: &artists,
            sets: &sets,
        },
        "prints",
    )?;

    // Ordered as the cards file is, so each card's printings are one
    // contiguous run, and to a total order — see `docs/search.md`. The finish
    // clause keeps 9ed #329 ahead of the foil-only #329★.
    let mut rows = sqlx::query_as::<_, PrintRow>(
        "SELECT c.id, c.set_code, c.collector_number, c.finishes, c.rarity,
                c.layout, c.image_status, c.lang, c.printed_name,
                nullif(c.artist, ''),
                c.promo | (c.variation << 1) | (c.full_art << 2)
                        | (c.textless << 3) | (c.oversized << 4)
         FROM cards c JOIN oracle o ON o.id = c.oracle_id
         WHERE NOT c.digital
         ORDER BY o.name, o.id,
                  CASE WHEN c.set_type IN ('expansion', 'core') THEN 0 ELSE 1 END,
                  c.booster DESC, c.released_at DESC,
                  instr(c.finishes, 'nonfoil') = 0,
                  c.collector_number, c.id",
    )
    .fetch(pool);

    let mut count = 0;
    while let Some(row) = rows.try_next().await? {
        let (id, set, number, finishes, rarity, layout, status, lang, printed, artist, flags) = row;
        out.row(&(
            id,
            set_index[&set],
            number,
            finish_mask(&finishes),
            rarity_index[&rarity],
            layout_index[&layout],
            status_index[&status],
            lang_index[&lang],
            printed,
            artist.and_then(|name| artist_index.get(&name).copied()),
            flags,
        ))?;
        count += 1;
    }

    Ok(Artifact::new("prints", count, out.finish()?))
}

const ARTISTS: &str = "SELECT artist FROM cards WHERE NOT digital
     AND coalesce(artist, '') <> '' GROUP BY artist ORDER BY count(*) DESC";
const RARITIES: &str =
    "SELECT rarity FROM cards WHERE NOT digital GROUP BY rarity ORDER BY count(*) DESC";
const LAYOUTS: &str =
    "SELECT layout FROM cards WHERE NOT digital GROUP BY layout ORDER BY count(*) DESC";
const IMAGE_STATUSES: &str = "SELECT image_status FROM cards WHERE NOT digital
     GROUP BY image_status ORDER BY count(*) DESC";
const LANGS: &str = "SELECT lang FROM cards WHERE NOT digital GROUP BY lang ORDER BY count(*) DESC";

/// Distinct values of one column, commonest first.
async fn common_first(pool: &SqlitePool, query: &'static str) -> Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(query).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(value,)| value).collect())
}

fn index(values: impl Iterator<Item = String>) -> HashMap<String, usize> {
    values.enumerate().map(|(n, value)| (value, n)).collect()
}

/// Scryfall's `finishes` array as a bitmask over [`FINISHES`]. An unknown
/// finish is dropped rather than shifting the ones we know.
fn finish_mask(json: &str) -> u8 {
    let finishes: Vec<String> = serde_json::from_str(json).unwrap_or_default();
    finishes
        .iter()
        .filter_map(|finish| FINISHES.iter().position(|known| known == finish))
        .fold(0, |mask, bit| mask | 1 << bit)
}

/// Streams rows into the buffer as they arrive, so no intermediate `Vec` of
/// a hundred thousand rows exists.
struct Writer {
    out: Vec<u8>,
    rows: usize,
}

impl Writer {
    /// Opens the object with `header`'s fields, then the array `rows` go in.
    fn new<H: Serialize>(header: &H, array: &str) -> Result<Self> {
        let mut json = serde_json::to_string(header)?;
        // The rows belong to the same object, so the header's closing brace
        // comes off here and `finish` puts it back.
        json.pop();

        let mut out = Vec::new();
        write!(out, "{json},\"{array}\":[")?;
        Ok(Self { out, rows: 0 })
    }

    fn row<T: Serialize>(&mut self, row: &T) -> Result<()> {
        if self.rows > 0 {
            self.out.write_all(b",")?;
        }
        serde_json::to_writer(&mut self.out, row)?;
        self.rows += 1;
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<u8>> {
        self.out.write_all(b"]}")?;
        Ok(self.out)
    }
}
