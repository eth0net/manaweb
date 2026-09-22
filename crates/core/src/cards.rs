//! The Scryfall card cache: one full replace per bulk file, plus the lookups
//! v0 needs.
//!
//! Two tables rather than one, for the reasons in `docs/scryfall.md`.

use std::cmp::Reverse;
use std::collections::hash_map::Entry;
use std::collections::{BTreeSet, HashMap};

use manaweb_scryfall::{BulkData, Card, CardStream, Color, Error as ScryfallError};
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::{Error, Result};

/// What one replace did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SyncReport {
    /// Printings written.
    pub written: i64,
    /// Distinct cards those printings belong to.
    pub cards: i64,
    /// Lines that didn't parse. Skipped rather than fatal, so one odd record
    /// doesn't cost a week's refresh — but a jump here means Scryfall changed
    /// something, and it's the caller's job to notice.
    pub skipped: i64,
}

/// The `updated_at` of the last file ingested for `kind`, if any.
///
/// # Errors
///
/// Fails on a database error.
pub async fn last_synced(pool: &SqlitePool, kind: &str) -> Result<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT updated_at FROM bulk_sync WHERE kind = ?")
        .bind(kind)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(updated_at,)| updated_at))
}

/// Replaces the entire cache from `cards`, in one transaction.
///
/// Readers stay on the previous catalog until it commits, and a failure part
/// way leaves that catalog intact.
///
/// # Errors
///
/// Fails on a database error, an unreadable stream, or a stream that yielded no
/// cards at all — that last one would otherwise empty the cache silently.
pub async fn replace(
    pool: &SqlitePool,
    bulk: &BulkData,
    cards: &mut CardStream,
) -> Result<SyncReport> {
    let mut tx = pool.begin().await?;
    let mut report = SyncReport::default();
    let mut legalities = HashMap::new();
    let mut oracles: HashMap<String, Oracle> = HashMap::new();

    // Printings are written before their oracle rows exist, since printings
    // are what decide a card's representative one.
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await?;
    for statement in [
        "DELETE FROM card_search",
        "DELETE FROM cards",
        "DELETE FROM oracle",
        "DELETE FROM legalities",
    ] {
        sqlx::query(statement).execute(&mut *tx).await?;
    }

    loop {
        match cards.try_next().await {
            Ok(None) => break,
            Ok(Some(card)) => {
                let legalities_id = intern_legalities(&mut tx, &mut legalities, &card).await?;
                insert_printing(&mut tx, &card, legalities_id).await?;
                Oracle::absorb(&mut oracles, &card);
                report.written += 1;
            }
            // One unparsable line shouldn't cost the whole refresh.
            Err(ScryfallError::Parse { .. }) => report.skipped += 1,
            Err(other) => return Err(other.into()),
        }
    }

    if report.written == 0 {
        // Dropping the transaction rolls back the deletes.
        return Err(Error::EmptySync);
    }

    report.cards = i64::try_from(oracles.len()).unwrap_or(i64::MAX);
    for (id, oracle) in &oracles {
        oracle.insert(&mut tx, id).await?;
    }

    sqlx::query(
        "INSERT INTO bulk_sync (kind, updated_at, card_count) VALUES (?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET
             updated_at = excluded.updated_at,
             card_count = excluded.card_count,
             synced_at  = datetime('now')",
    )
    .bind(&bulk.kind)
    .bind(&bulk.updated_at)
    .bind(report.written)
    .execute(&mut *tx)
    .await?;

    crate::catalog::order(&mut tx).await?;

    tx.commit().await?;

    // The replace writes the whole catalog, so the WAL is about as large as
    // the database until it's checkpointed. Small VPS, so reclaim it now.
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(pool)
        .await?;

    Ok(report)
}

/// A card under construction, accumulated across its printings.
///
/// Fields come from the best-ranked printing, then anything still missing from
/// whichever printing has it — which is what fills in reversible printings.
#[derive(Debug)]
struct Oracle {
    rank: Rank,
    name: String,
    type_line: Option<String>,
    mana_cost: Option<String>,
    cmc: Option<f64>,
    text: Option<String>,
    colors: Option<String>,
    color_identity: String,
    power: Option<String>,
    toughness: Option<String>,
    loyalty: Option<String>,
    defense: Option<String>,
    keywords: String,
    reserved: bool,
    edhrec_rank: Option<i64>,
    game_changer: Option<bool>,
    kind: i64,
    paper: bool,
    printings: i64,
    default_print: String,
    printed_names: BTreeSet<String>,
}

/// Orders printings so the one a person means comes first: paper over digital,
/// a set someone drafted over a boutique release, then newest.
type Rank = (bool, bool, bool, Reverse<String>);

fn rank(card: &Card) -> Rank {
    (
        card.digital,
        !matches!(card.set_type.as_str(), "expansion" | "core"),
        !card.booster,
        Reverse(card.released_at.clone()),
    )
}

/// 0 card, 1 token or emblem, 2 art series. Search ranks in that order.
fn kind(card: &Card) -> i64 {
    match card.layout.as_str() {
        "token" | "double_faced_token" | "emblem" => 1,
        "art_series" => 2,
        _ => 0,
    }
}

impl Oracle {
    fn from(card: &Card) -> Self {
        Self {
            rank: rank(card),
            name: card.name.clone(),
            type_line: card.type_line.clone(),
            mana_cost: card.mana_cost.clone(),
            cmc: card.cmc.map(f64::from),
            text: card.oracle_text.clone(),
            colors: card.colors.as_deref().map(canonical_colors),
            color_identity: canonical_colors(&card.color_identity),
            power: card.power.clone(),
            toughness: card.toughness.clone(),
            loyalty: card.loyalty.clone(),
            defense: card.defense.clone(),
            keywords: json(&card.keywords),
            reserved: card.reserved,
            edhrec_rank: card.edhrec_rank.map(i64::from),
            game_changer: card.game_changer,
            kind: kind(card),
            paper: !card.digital,
            // Paper only: the count is what a collector could own, and search
            // never returns a card that exists nowhere but Arena.
            printings: i64::from(!card.digital),
            default_print: card.id.to_string(),
            printed_names: card.printed_name.clone().into_iter().collect(),
        }
    }

    fn absorb(oracles: &mut HashMap<String, Self>, card: &Card) {
        // The lifted id, not `card.oracle_id`: a reversible printing has none
        // at the top level, and must still land under the card it depicts.
        let Some(id) = oracle_id(card) else {
            return;
        };
        let incoming = Self::from(card);

        match oracles.entry(id) {
            Entry::Vacant(slot) => {
                slot.insert(incoming);
            }
            // Whichever ranks better keeps its own fields and folds the
            // other in, so the file's order decides nothing.
            Entry::Occupied(slot) => {
                let entry = slot.into_mut();
                if incoming.rank < entry.rank {
                    let displaced = std::mem::replace(entry, incoming);
                    entry.merge(displaced);
                } else {
                    entry.merge(incoming);
                }
            }
        }
    }

    /// Folds in a printing this one outranks: counts add, and anything missing
    /// here comes from there.
    fn merge(&mut self, other: Self) {
        self.printings += other.printings;
        self.printed_names.extend(other.printed_names);
        self.kind = self.kind.min(other.kind);
        self.paper |= other.paper;

        fill(&mut self.type_line, other.type_line);
        fill(&mut self.mana_cost, other.mana_cost);
        fill(&mut self.cmc, other.cmc);
        fill(&mut self.text, other.text);
        fill(&mut self.colors, other.colors);
        fill(&mut self.power, other.power);
        fill(&mut self.toughness, other.toughness);
        fill(&mut self.loyalty, other.loyalty);
        fill(&mut self.defense, other.defense);
    }

    async fn insert(&self, tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO oracle (
                id, name, type_line, mana_cost, cmc, oracle_text, colors,
                color_identity, power, toughness, loyalty, defense, keywords,
                reserved, edhrec_rank, game_changer, kind, paper, printings,
                default_print
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(&self.name)
        .bind(&self.type_line)
        .bind(&self.mana_cost)
        .bind(self.cmc)
        .bind(&self.text)
        .bind(&self.colors)
        .bind(&self.color_identity)
        .bind(&self.power)
        .bind(&self.toughness)
        .bind(&self.loyalty)
        .bind(&self.defense)
        .bind(&self.keywords)
        .bind(self.reserved)
        .bind(self.edhrec_rank)
        .bind(self.game_changer)
        .bind(self.kind)
        .bind(self.paper)
        .bind(self.printings)
        .bind(&self.default_print)
        .execute(&mut **tx)
        .await?;

        sqlx::query("INSERT INTO card_search (name, printed_names, oracle_id) VALUES (?, ?, ?)")
            .bind(&self.name)
            .bind(
                self.printed_names
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" "),
            )
            .bind(id)
            .execute(&mut **tx)
            .await?;

        Ok(())
    }
}

fn fill<T>(slot: &mut Option<T>, from: Option<T>) {
    if slot.is_none() {
        *slot = from;
    }
}

/// Stores each distinct legality combination once and hands back its id.
async fn intern_legalities(
    tx: &mut Transaction<'_, Sqlite>,
    seen: &mut HashMap<String, i64>,
    card: &Card,
) -> Result<i64> {
    let encoded = json(&card.legalities);
    if let Some(id) = seen.get(&encoded) {
        return Ok(*id);
    }

    let (id,): (i64,) = sqlx::query_as("INSERT INTO legalities (json) VALUES (?) RETURNING id")
        .bind(&encoded)
        .fetch_one(&mut **tx)
        .await?;
    seen.insert(encoded, id);
    Ok(id)
}

async fn insert_printing(
    tx: &mut Transaction<'_, Sqlite>,
    card: &Card,
    legalities_id: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO cards (
            id, oracle_id, printed_name, lang, released_at, layout,
            set_code, set_name, set_type, collector_number, rarity,
            legalities_id, games, finishes,
            digital, promo, reprint, variation, oversized, booster, full_art,
            textless, border_color, frame, artist, illustration_id,
            flavor_text, image_status, card_faces
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?
        )",
    )
    .bind(card.id.to_string())
    .bind(oracle_id(card))
    .bind(&card.printed_name)
    .bind(&card.lang)
    .bind(&card.released_at)
    .bind(&card.layout)
    .bind(&card.set_code)
    .bind(&card.set_name)
    .bind(&card.set_type)
    .bind(&card.collector_number)
    .bind(&card.rarity)
    .bind(legalities_id)
    .bind(json(&card.games))
    .bind(json(&card.finishes))
    .bind(card.digital)
    .bind(card.promo)
    .bind(card.reprint)
    .bind(card.variation)
    .bind(card.oversized)
    .bind(card.booster)
    .bind(card.full_art)
    .bind(card.textless)
    .bind(&card.border_color)
    .bind(&card.frame)
    .bind(&card.artist)
    .bind(illustration_id(card))
    .bind(&card.flavor_text)
    .bind(&card.image_status)
    .bind(card.card_faces.as_ref().map(|faces| faces.get().to_owned()))
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// What the cache lifts off a face where the top level omits it. Serde fills
/// only what it finds, so each reader takes the one field it came for.
#[derive(serde::Deserialize)]
struct Face {
    oracle_id: Option<String>,
    illustration_id: Option<String>,
}

/// Scryfall omits the top-level `oracle_id` on `reversible_card` printings, but
/// both faces carry it and across all 81 they agree. Lift it, or a card you own
/// can't be referenced by a deck: design entries key on `oracle_id`.
fn oracle_id(card: &Card) -> Option<String> {
    if let Some(id) = card.oracle_id {
        return Some(id.to_string());
    }

    let faces: Vec<Face> = serde_json::from_str(card.card_faces.as_ref()?.get()).ok()?;
    faces.into_iter().find_map(|face| face.oracle_id)
}

/// A two-faced printing carries its artwork per face and nothing at the top,
/// so the front's is the one a scanner reads off the card in hand.
fn illustration_id(card: &Card) -> Option<String> {
    if let Some(id) = card.illustration_id {
        return Some(id.to_string());
    }

    let faces: Vec<Face> = serde_json::from_str(card.card_faces.as_ref()?.get()).ok()?;
    faces.into_iter().next()?.illustration_id
}

/// WUBRG order, so a color identity compares as a string. `Color` is declared
/// in that order, so sorting is enough.
fn canonical_colors(colors: &[Color]) -> String {
    let mut sorted = colors.to_vec();
    sorted.sort_unstable();
    sorted.iter().map(|color| color.as_str()).collect()
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("card fields are plain data")
}

/// Printings in the cache.
///
/// # Errors
///
/// Fails on a database error.
pub async fn count(pool: &SqlitePool) -> Result<i64> {
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM cards")
        .fetch_one(pool)
        .await?;
    Ok(count)
}

/// The print a CSV row identifies. Unique across Default Cards, so at most one.
///
/// # Errors
///
/// Fails on a database error.
pub async fn printing_id(
    pool: &SqlitePool,
    set_code: &str,
    collector_number: &str,
    lang: &str,
) -> Result<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM cards
         WHERE set_code = ? AND collector_number = ? AND lang = ?",
    )
    .bind(set_code)
    .bind(collector_number)
    .bind(lang)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

/// Enough of a card to render a search result.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CardBrief {
    pub oracle_id: String,
    pub name: String,
    pub type_line: Option<String>,
    /// Printings of this card, so a grouped result needn't count them again.
    pub printings: i64,
    pub print_id: String,
    pub set_code: String,
    pub collector_number: String,
    pub lang: String,
    pub layout: String,
    pub image_status: String,
}

/// What a search should surface.
///
/// Digital-only cards are never returned: they can't be owned on paper.
#[derive(Debug, Clone, Copy)]
pub struct Search {
    /// One row per card rather than per printing.
    pub group_printings: bool,
    pub tokens: bool,
    pub art_series: bool,
    pub limit: u32,
}

impl Default for Search {
    fn default() -> Self {
        Self {
            group_printings: true,
            tokens: true,
            art_series: true,
            limit: 20,
        }
    }
}

/// One row per card, showing its representative printing.
const GROUPED: &str = "\
    SELECT o.id AS oracle_id, o.name, o.type_line, o.printings,
           c.id AS print_id, c.set_code, c.collector_number, c.lang,
           c.layout, c.image_status
    FROM card_search s
    JOIN oracle o ON o.id = s.oracle_id
    JOIN cards c ON c.id = o.default_print
    WHERE card_search MATCH ?1 AND o.paper
      AND (o.kind <> 1 OR ?3) AND (o.kind <> 2 OR ?4)
    ORDER BY CASE WHEN lower(o.name) = lower(?2) THEN 0 ELSE 1 END,
             o.kind, bm25(card_search)
    LIMIT ?5";

/// Every printing, ordered within its card the way the representative is
/// chosen: paper first, then a set someone drafted, then newest.
const UNGROUPED: &str = "\
    SELECT o.id AS oracle_id, o.name, o.type_line, o.printings,
           c.id AS print_id, c.set_code, c.collector_number, c.lang,
           c.layout, c.image_status
    FROM card_search s
    JOIN oracle o ON o.id = s.oracle_id
    JOIN cards c ON c.oracle_id = o.id
    WHERE card_search MATCH ?1 AND o.paper AND NOT c.digital
      AND (o.kind <> 1 OR ?3) AND (o.kind <> 2 OR ?4)
    ORDER BY CASE WHEN lower(o.name) = lower(?2) THEN 0 ELSE 1 END,
             o.kind, bm25(card_search),
             CASE WHEN c.set_type IN ('expansion', 'core') THEN 0 ELSE 1 END,
             c.booster DESC, c.released_at DESC
    LIMIT ?5";

/// Name search, for a client that hasn't cached the catalog yet.
///
/// Ranks cards above tokens above art series, with an exact name match above
/// all three.
///
/// # Errors
///
/// Fails on a database error.
pub async fn search(pool: &SqlitePool, query: &str, opts: Search) -> Result<Vec<CardBrief>> {
    let Some(fts) = fts_query(query) else {
        return Ok(Vec::new());
    };

    Ok(sqlx::query_as(if opts.group_printings {
        GROUPED
    } else {
        UNGROUPED
    })
    .bind(fts)
    .bind(query.trim())
    .bind(opts.tokens)
    .bind(opts.art_series)
    .bind(opts.limit)
    .fetch_all(pool)
    .await?)
}

/// Quotes each word and makes it a prefix, so user input can't be FTS5 syntax.
/// `None` when there's nothing to search for.
fn fts_query(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect();

    (!terms.is_empty()).then(|| terms.join(" "))
}
