//! Fetches a deployment and holds it to what a browser needs.
//!
//!     manaweb-verify catalog [origin]
//!     manaweb-verify oauth [url]
//!
//! Needs a deployment rather than a checkout, which is why neither is in
//! `just check`.

use std::error::Error;
use std::{env, process};

use manaweb_objects::verify;

const CATALOG: &str = "https://static.manaweb.app/catalog";
const OAUTH: &str = "https://manaweb.app/oauth/client-metadata.json";

#[tokio::main]
async fn main() {
    match run().await {
        Err(error) => {
            eprintln!("  FAIL  {error}");
            process::exit(1);
        }
        Ok(false) => process::exit(1),
        Ok(true) => {}
    }
}

async fn run() -> Result<bool, Box<dyn Error>> {
    let what = env::args().nth(1).unwrap_or_default();
    let given = env::args().nth(2);

    let found = match what.as_str() {
        "catalog" => verify::catalog(&given.unwrap_or_else(|| CATALOG.to_owned())).await?,
        "oauth" => verify::oauth(&given.unwrap_or_else(|| OAUTH.to_owned())).await?,
        _ => return Err("usage: manaweb-verify <catalog|oauth> [url]".into()),
    };

    Ok(found.report())
}
