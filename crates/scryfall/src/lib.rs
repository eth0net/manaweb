//! A reader for Scryfall's bulk card data.
//!
//! Fetches the bulk-data index, streams a gzipped NDJSON file a line at a time
//! and parses each line into a [`Card`]. No database and no atproto: this
//! layer's whole job is faithful parsing.

mod bulk;
mod card;
mod client;
mod error;
mod stream;

pub use bulk::{BulkData, BulkIndex, BulkKind};
pub use card::{Card, Color, Prices};
pub use client::{Client, USER_AGENT};
pub use error::Error;
pub use stream::CardStream;

pub type Result<T> = std::result::Result<T, Error>;
