//! Streams the sealed tables from MTGJSON and reports what came back.
//!
//! ```sh
//! cargo run --release -p manaweb-mtgjson --example tables
//! ```
//!
//! Deliberately not a test: it pulls ~24MB from a free service.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::error::Error;
use std::time::Instant;

use manaweb_mtgjson::{
    Client, Deck, Identity, Product, Pull, Sheet, Slot, Table, USER_AGENT, Variant,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let client = Client::new(USER_AGENT)?;
    let meta = client.meta().await?;
    println!("build {}, dated {}", meta.version, meta.date);

    let started = Instant::now();

    let mut products = client.download::<Product>(Table::SealedProducts).await?;
    let mut kinds: BTreeMap<&str, u64> = BTreeMap::new();
    let mut sets = BTreeMap::new();
    while let Some(product) = products.try_next().await? {
        let held = &product.contents;
        for (kind, count) in [
            ("card", held.card.len()),
            ("deck", held.deck.len()),
            ("sealed", held.sealed.len()),
            ("pack", held.pack.len()),
            ("variable", held.variable.len()),
            ("other", held.other.len()),
        ] {
            if count > 0 {
                *kinds.entry(kind).or_default() += 1;
            }
        }
        *sets.entry(product.set_code).or_insert(0u64) += 1;
    }
    println!(
        "\n{} products across {} sets, by content kind:",
        products.row(),
        sets.len()
    );
    for (kind, count) in &kinds {
        println!("  {kind:10} {count:>6}");
    }

    let mut decks = client.download::<Deck>(Table::SetDecks).await?;
    let mut entries = 0u64;
    let mut tokens = 0u64;
    while let Some(deck) = decks.try_next().await? {
        entries += (deck.main_board.len() + deck.side_board.len() + deck.commander.len()) as u64;
        tokens += deck.tokens.len() as u64;
    }
    println!(
        "\n{} decklists, {entries} card entries, {tokens} tokens",
        decks.row()
    );

    let mut slots = client.download::<Slot>(Table::SetBoosterContents).await?;
    let mut configs = BTreeSet::new();
    while let Some(slot) = slots.try_next().await? {
        configs.insert((slot.set_code, slot.booster_name));
    }
    println!("\n{} slot rows over {} configs", slots.row(), configs.len());

    let mut variants = client
        .download::<Variant>(Table::SetBoosterContentWeights)
        .await?;
    let mut layouts: BTreeMap<(String, String), u64> = BTreeMap::new();
    while let Some(variant) = variants.try_next().await? {
        *layouts
            .entry((variant.set_code, variant.booster_name))
            .or_default() += 1;
    }
    let fixed = layouts.values().filter(|&&held| held == 1).count();
    println!(
        "{} variants, {fixed} of {} configs having only the one",
        variants.row(),
        layouts.len()
    );

    let mut sheets = client.download::<Sheet>(Table::SetBoosterSheets).await?;
    let mut foil = 0u64;
    let mut balanced = 0u64;
    while let Some(sheet) = sheets.try_next().await? {
        foil += u64::from(sheet.sheet_is_foil);
        balanced += u64::from(sheet.sheet_has_balance_colors);
    }
    println!(
        "{} sheets, {foil} foil, {balanced} drawn to even out colors",
        sheets.row()
    );

    let mut pulls = client.download::<Pull>(Table::SetBoosterSheetCards).await?;
    let mut pool = HashSet::new();
    while let Some(pull) = pulls.try_next().await? {
        pool.insert(pull.card_uuid);
    }
    println!("{} pulls naming {} uuids", pulls.row(), pool.len());

    // Resolving the pool rides along with counting the identifier tables,
    // which are 17MB and are not worth a second pass.
    let mut printings = HashSet::new();
    for table in [Table::CardIdentifiers, Table::TokenIdentifiers] {
        let mut rows = client.download::<Identity>(table).await?;
        let mut all = BTreeSet::new();
        while let Some(one) = rows.try_next().await? {
            all.insert(one.scryfall_id);
            if pool.remove(&one.uuid) {
                printings.insert(one.scryfall_id);
            }
        }
        println!("{table}: {} uuids over {} printings", rows.row(), all.len());
    }
    println!(
        "\npool resolves to {} printings, {} uuids reaching none",
        printings.len(),
        pool.len()
    );

    println!("\n{:.1}s", started.elapsed().as_secs_f64());
    Ok(())
}
