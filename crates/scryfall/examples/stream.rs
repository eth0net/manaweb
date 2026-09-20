//! Streams Default Cards from Scryfall and reports what came back.
//!
//! ```sh
//! cargo run --release -p manaweb-scryfall --example stream
//! ```
//!
//! Deliberately not a test: it pulls ~78MB from a free service.

use std::collections::BTreeMap;
use std::error::Error;
use std::time::Instant;

use manaweb_scryfall::{BulkKind, Client, USER_AGENT};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let client = Client::new(USER_AGENT)?;
    let bulk = client.bulk_data(BulkKind::DefaultCards).await?;
    println!(
        "{}, updated {}, {:.0}MB compressed",
        bulk.name,
        bulk.updated_at,
        f64::from(u32::try_from(bulk.compressed_size)?) / 1e6,
    );

    let started = Instant::now();
    let mut stream = client.download(&bulk).await?;
    let mut layouts: BTreeMap<String, u64> = BTreeMap::new();
    let mut without_oracle_id = 0u64;
    let mut with_faces = 0u64;
    let mut languages: BTreeMap<String, u64> = BTreeMap::new();

    while let Some(card) = stream.try_next().await? {
        *layouts.entry(card.layout).or_default() += 1;
        *languages.entry(card.lang).or_default() += 1;
        without_oracle_id += u64::from(card.oracle_id.is_none());
        with_faces += u64::from(card.card_faces.is_some());
    }

    let total: u64 = layouts.values().sum();
    println!(
        "\n{total} printings in {:.1}s, {} languages",
        started.elapsed().as_secs_f64(),
        languages.len(),
    );
    println!("{without_oracle_id} without an oracle id, {with_faces} with faces\n");
    for (layout, count) in &layouts {
        println!("  {layout:20} {count:>7}");
    }

    Ok(())
}
