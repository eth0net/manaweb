//! Filling the scanner index: one perceptual hash per artwork.
//!
//! Built from Scryfall's images, which is gigabytes at a throttle and hours of
//! hashing, so it runs on a workstation and never on the server — see
//! `docs/architecture.md`. The hashing itself is `manaweb-scanner`, which a
//! browser runs against the same artwork.

pub mod artwork;
pub mod degrade;
mod error;
pub mod fetch;
pub mod luma;

pub use artwork::Artwork;
pub use error::Error;

pub type Result<T> = std::result::Result<T, Error>;

/// Opens the cache read-only: nothing here writes to it, and a build runs for
/// hours beside whatever else has the file open.
///
/// # Errors
///
/// Fails if the file can't be opened.
pub async fn open(path: &str) -> Result<sqlx::SqlitePool> {
    use std::str::FromStr as _;

    let options =
        sqlx::sqlite::SqliteConnectOptions::from_str(&format!("sqlite://{path}"))?.read_only(true);
    Ok(sqlx::SqlitePool::connect_with(options).await?)
}
