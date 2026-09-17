//! Uploads an artifact set by hand, the way the server does after a refresh.
//!
//!     manaweb-upload <prefix> [dir]
//!
//! The prefix names the set and is required, because which one this is cannot
//! be guessed from a directory. The directory defaults to `MANAWEB_CATALOG`,
//! then to the prefix. The bucket and its credentials come from the
//! environment — see the library.

use std::error::Error;
use std::path::PathBuf;
use std::{env, process};

use manaweb_objects::Bucket;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("  FAIL  {error}");
        process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    let Some(prefix) = env::args().nth(1) else {
        return Err("usage: manaweb-upload <prefix> [dir]".into());
    };
    let dir = env::args().nth(2).map_or_else(
        || PathBuf::from(env::var("MANAWEB_CATALOG").unwrap_or_else(|_| prefix.clone())),
        PathBuf::from,
    );

    let Some(bucket) = Bucket::from_env()? else {
        return Err("MANAWEB_S3_ENDPOINT is unset, so there is nowhere to send this".into());
    };

    let done = bucket.upload(&prefix, &dir).await?;
    for name in &done.held {
        println!("  held  {prefix}/{name}");
    }
    for name in &done.sent {
        println!("  sent  {prefix}/{name}");
    }
    println!("\nversion {}", done.version);
    Ok(())
}
