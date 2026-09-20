//! Syncs the card cache from Scryfall's Default Cards file.
//!
//! ```sh
//! cargo run --release -p manaweb-core --example sync -- cards.db
//! # or from a copy already on disk, to leave a free service alone:
//! cargo run --release -p manaweb-core --example sync -- cards.db default-cards.jsonl.gz
//! ```

use std::env;
use std::error::Error;
use std::time::Instant;

use manaweb_core::cards::{self, Search};
use manaweb_core::open;
use manaweb_scryfall::{BulkKind, CardStream, Client, USER_AGENT};
use tokio::fs::File;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let db = args.next().unwrap_or_else(|| "cards.db".to_owned());
    let local = args.next();

    let pool = open(&db).await?;
    let client = Client::new(USER_AGENT)?;

    // The index is 3KB, so it's cheap even when the file is already on disk.
    let bulk = client.bulk_data(BulkKind::DefaultCards).await?;
    if cards::last_synced(&pool, &bulk.kind).await?.as_deref() == Some(&bulk.updated_at) {
        println!("{} is already synced ({})", bulk.name, bulk.updated_at);
        return Ok(());
    }

    let mut stream = if let Some(path) = &local {
        println!("reading {path}");
        CardStream::gzipped(File::open(path).await?)
    } else {
        println!("downloading {}", bulk.jsonl_download_uri);
        client.download(&bulk).await?
    };

    let started = Instant::now();
    let report = cards::replace(&pool, &bulk, &mut stream).await?;
    println!(
        "wrote {} printings of {} cards, skipped {}, in {:.1}s",
        report.written,
        report.cards,
        report.skipped,
        started.elapsed().as_secs_f64(),
    );

    let opts = Search {
        limit: 3,
        ..Search::default()
    };
    for hit in cards::search(&pool, "lightning bolt", opts).await? {
        println!(
            "  {} — {} {} #{}, {} printings",
            hit.name, hit.set_code, hit.lang, hit.collector_number, hit.printings
        );
    }

    Ok(())
}
