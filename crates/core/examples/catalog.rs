//! Builds the client catalog artifact from a synced cache and reports its
//! size, which is the number that has to stay under the target in
//! `docs/architecture.md`.
//!
//! ```sh
//! cargo run --release -p manaweb-core --example catalog -- cards.db
//! # or with somewhere to write the files, to look at them:
//! cargo run --release -p manaweb-core --example catalog -- cards.db out/
//! # and with the artwork hashes `manaweb-artwork hash` left, to publish the index:
//! cargo run --release -p manaweb-core --example catalog -- cards.db out/ hashes
//! ```

use std::env;
use std::error::Error;
use std::time::Instant;

use manaweb_core::{catalog, open};
use manaweb_scanner::Store;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let db = args.next().unwrap_or_else(|| "cards.db".to_owned());
    let out = args.next().filter(|dir| !dir.is_empty());
    let hashes = args.next().filter(|path| !path.is_empty());
    let pool = open(&db).await?;

    let store = match hashes {
        Some(path) => Some(Store::read(&std::fs::read(path)?)?),
        None => None,
    };

    let started = Instant::now();
    let built = catalog::build(&pool, store.as_ref()).await?;
    let elapsed = started.elapsed().as_secs_f64();

    if let Some(dir) = &out {
        built.write(dir).await?;
    }

    let mut total = 0;
    for file in [
        Some(&built.cards),
        Some(&built.prints),
        built.artwork.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        total += file.bytes.len();
        println!(
            "  {:<28} {:>7} rows  {:>6.2}MB",
            file.name,
            file.rows,
            megabytes(file.bytes.len()),
        );
    }
    println!(
        "{} in {elapsed:.1}s, {:.2}MB uncompressed",
        built.version,
        megabytes(total),
    );

    Ok(())
}

#[expect(
    clippy::cast_precision_loss,
    reason = "a byte count of a few million is exact in f64"
)]
fn megabytes(bytes: usize) -> f64 {
    bytes as f64 / 1e6
}
