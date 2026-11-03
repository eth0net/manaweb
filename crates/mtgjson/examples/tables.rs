//! Streams the sealed tables from MTGJSON and reports what came back.
//!
//! ```sh
//! cargo run --release -p manaweb-mtgjson --example tables
//! ```
//!
//! Deliberately not a test: it pulls ~19MB from a free service.

use std::collections::BTreeMap;
use std::error::Error;
use std::time::Instant;

use manaweb_mtgjson::{Client, Deck, Identity, Product, Table, USER_AGENT};

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

    for table in [Table::CardIdentifiers, Table::TokenIdentifiers] {
        let mut rows = client.download::<Identity>(table).await?;
        let mut printings = std::collections::BTreeSet::new();
        while let Some(one) = rows.try_next().await? {
            printings.insert(one.scryfall_id);
        }
        println!(
            "{table}: {} uuids over {} printings",
            rows.row(),
            printings.len()
        );
    }

    println!("\n{:.1}s", started.elapsed().as_secs_f64());
    Ok(())
}
