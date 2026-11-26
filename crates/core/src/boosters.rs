//! The booster cache: what a pack can draw from, out of MTGJSON.
//!
//! One full replace per build, like the card cache, and resolved against it:
//! a sheet names cards by MTGJSON's uuid and this is where that stops being
//! true. Reasoning and figures are in `docs/products.md`.

use std::collections::HashMap;

use manaweb_mtgjson::{Identity, Pull, Rows, Sheet, Slot, Variant};
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{Error, Result};

/// A sheet's own key, which is a set's and a configuration's before it is a
/// name: `blb`'s `common` sheet is not `mh3`'s.
type Sheets = HashMap<(String, String, String), i64>;

/// A set code as the card cache spells it.
///
/// MTGJSON's tables carry it upper case and the JSON inside their columns
/// carries it lower, so one of the two has to give and the cache already
/// chose. Sheet names keep their own case, being camelCase to begin with.
fn code(set_code: &str) -> String {
    set_code.to_lowercase()
}

/// Pool rows allowed to reach no printing before the sync is refused.
///
/// Every one measured was a printing the cache holds and does not export,
/// which is counted apart; this is for the other kind, a sheet naming cards
/// the cache has never heard of.
const ALLOWED_MISSING: f64 = 0.01;

/// Below this many pool rows the share above means little, so only an empty
/// sync is refused.
const ENOUGH_READ: i64 = 1_000;

/// How much of the last sheet count a new one has to keep.
const LEAST_KEPT: f64 = 0.95;

/// What one replace did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Report {
    pub sheets: i64,
    pub variants: i64,
    pub slots: i64,
    /// Cards placed on sheets.
    pub pool: i64,
    /// Of those, the ones the cache exports no position for. Every card of a
    /// digital configuration is one, which is the whole of sixteen of them.
    pub digital: i64,
    /// Pool rows reaching no printing at all: a uuid the identifier tables do
    /// not carry, or a printing the cache has never held.
    pub missing: i64,
}

/// The five tables one sync reads, opened by the caller so tests can hand it
/// fixtures and the refresh can hand it downloads.
///
/// `tokenIdentifiers` is not among them: no card on any sheet is keyed there,
/// so a booster resolves whole without it. A decklist's `tokens` board does
/// not — see `docs/products.md`.
#[derive(Debug)]
pub struct Tables {
    /// Read first and held only for the length of the sync.
    pub identities: Rows<Identity>,
    pub sheets: Rows<Sheet>,
    pub variants: Rows<Variant>,
    pub slots: Rows<Slot>,
    pub pool: Rows<Pull>,
}

/// Replaces the booster cache from one MTGJSON build.
///
/// Refuses rather than publishes a half-filled one: the transaction rolls
/// back, leaving whatever the last good sync wrote.
///
/// # Errors
///
/// Fails on a database or stream error, and refuses a build that reads empty,
/// that names printings the cache has never held, or that holds markedly
/// fewer sheets than the last.
pub async fn replace(pool: &SqlitePool, tables: Tables) -> Result<Report> {
    let Tables {
        mut identities,
        mut sheets,
        mut variants,
        mut slots,
        pool: mut pulls,
    } = tables;

    let printing = identify(&mut identities).await?;
    let before = count(pool).await?;
    let mut tx = pool.begin().await?;
    let mut report = Report::default();

    for statement in [
        "DELETE FROM booster_pool",
        "DELETE FROM booster_slots",
        "DELETE FROM booster_variants",
        "DELETE FROM booster_sheets",
    ] {
        sqlx::query(statement).execute(&mut *tx).await?;
    }

    let ids = write_sheets(&mut tx, &mut sheets, &mut report).await?;
    write_variants(&mut tx, &mut variants, &mut report).await?;
    write_slots(&mut tx, &mut slots, &ids, &mut report).await?;
    let read = write_pool(&mut tx, &mut pulls, &ids, &printing, &mut report).await?;

    refuse(&report, read, before)?;
    report.digital = digital(&mut tx).await?;
    tx.commit().await?;
    Ok(report)
}

/// The identifier table as a map, held only for the length of the sync.
async fn identify(identities: &mut Rows<Identity>) -> Result<HashMap<Uuid, Uuid>> {
    let mut printing = HashMap::new();
    while let Some(one) = identities.try_next().await? {
        printing.insert(one.uuid, one.scryfall_id);
    }
    Ok(printing)
}

/// The sheets, answering with the ids the other three tables join on.
async fn write_sheets(
    tx: &mut Transaction<'_, Sqlite>,
    rows: &mut Rows<Sheet>,
    report: &mut Report,
) -> Result<Sheets> {
    let mut ids = Sheets::new();
    while let Some(sheet) = rows.try_next().await? {
        let id = sqlx::query(
            "INSERT INTO booster_sheets (set_code, booster, name, foil, balanced, weight)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(code(&sheet.set_code))
        .bind(&sheet.booster_name)
        .bind(&sheet.sheet_name)
        .bind(sheet.sheet_is_foil)
        .bind(sheet.sheet_has_balance_colors)
        .bind(held(sheet.sheet_total_weight))
        .execute(&mut **tx)
        .await?
        .last_insert_rowid();
        ids.insert(
            (code(&sheet.set_code), sheet.booster_name, sheet.sheet_name),
            id,
        );
        report.sheets += 1;
    }
    Ok(ids)
}

async fn write_variants(
    tx: &mut Transaction<'_, Sqlite>,
    rows: &mut Rows<Variant>,
    report: &mut Report,
) -> Result<()> {
    while let Some(variant) = rows.try_next().await? {
        sqlx::query(
            "INSERT INTO booster_variants (set_code, booster, variant, weight)
             VALUES (?, ?, ?, ?)",
        )
        .bind(code(&variant.set_code))
        .bind(&variant.booster_name)
        .bind(variant.booster_index)
        .bind(held(variant.booster_weight))
        .execute(&mut **tx)
        .await?;
        report.variants += 1;
    }
    Ok(())
}

async fn write_slots(
    tx: &mut Transaction<'_, Sqlite>,
    rows: &mut Rows<Slot>,
    ids: &Sheets,
    report: &mut Report,
) -> Result<()> {
    while let Some(slot) = rows.try_next().await? {
        let key = (code(&slot.set_code), slot.booster_name, slot.sheet_name);
        let Some(&sheet_id) = ids.get(&key) else {
            report.missing += 1;
            continue;
        };
        sqlx::query("INSERT INTO booster_slots (sheet_id, variant, picks) VALUES (?, ?, ?)")
            .bind(sheet_id)
            .bind(slot.booster_index)
            .bind(slot.sheet_picks)
            .execute(&mut **tx)
            .await?;
        report.slots += 1;
    }
    Ok(())
}

/// The pool, answering how many rows it read: what the refusal below is a
/// share of, which is not the same as what was written.
async fn write_pool(
    tx: &mut Transaction<'_, Sqlite>,
    rows: &mut Rows<Pull>,
    ids: &Sheets,
    printing: &HashMap<Uuid, Uuid>,
    report: &mut Report,
) -> Result<i64> {
    let mut read = 0i64;
    while let Some(pull) = rows.try_next().await? {
        read += 1;
        let key = (code(&pull.set_code), pull.booster_name, pull.sheet_name);
        let (Some(&sheet_id), Some(&card)) = (ids.get(&key), printing.get(&pull.card_uuid)) else {
            report.missing += 1;
            continue;
        };
        // Selected from `cards` rather than bound, so a printing the cache
        // has never held is counted here instead of failing the foreign key.
        let placed = sqlx::query(
            "INSERT INTO booster_pool (sheet_id, scryfall_id, weight)
             SELECT ?, id, ? FROM cards WHERE id = ?",
        )
        .bind(sheet_id)
        .bind(held(pull.card_weight))
        .bind(card.to_string())
        .execute(&mut **tx)
        .await?
        .rows_affected();
        if placed == 0 {
            report.missing += 1;
        } else {
            report.pool += 1;
        }
    }
    Ok(read)
}

/// The guards, each of which leaves the booster cache that is published where
/// it was: returning rolls the transaction back with the deletes in it.
#[expect(
    clippy::cast_precision_loss,
    reason = "a build of 2^53 rows is not the one being read"
)]
fn refuse(report: &Report, read: i64, before: Option<i64>) -> Result<()> {
    if report.sheets == 0 || report.pool == 0 {
        return Err(Error::EmptySync);
    }
    if read >= ENOUGH_READ && report.missing as f64 > read as f64 * ALLOWED_MISSING {
        return Err(Error::MissingPrintings {
            missing: report.missing,
            read,
        });
    }
    if let Some(before) = before
        && (report.sheets as f64) < before as f64 * LEAST_KEPT
    {
        return Err(Error::ShrunkSync {
            written: report.sheets,
            before,
        });
    }
    Ok(())
}

/// A weight as SQLite holds it. Saturating rather than wrapping, because a
/// weight past 2^63 is a feed to look at rather than a number to keep.
fn held(weight: u64) -> i64 {
    i64::try_from(weight).unwrap_or(i64::MAX)
}

/// Pool rows the catalog will leave out, counted inside the transaction that
/// wrote them so the number describes this sync rather than a later one.
async fn digital(tx: &mut Transaction<'_, Sqlite>) -> Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM booster_pool p
         JOIN cards c ON c.id = p.scryfall_id
         WHERE c.seq IS NULL",
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(count)
}

/// Sheets held before this sync, which is what its own count is weighed
/// against. `None` where the cache holds none yet.
async fn count(pool: &SqlitePool) -> Result<Option<i64>> {
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM booster_sheets")
        .fetch_one(pool)
        .await?;
    Ok((count > 0).then_some(count))
}
