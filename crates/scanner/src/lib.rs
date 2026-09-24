//! The scanner engine: pixels in, the hashes the artwork index is keyed by out.
//!
//! Deliberately bare — no image decoding, no database, no HTTP — because the
//! same code has to run in a browser and, later, on a phone. The builder that
//! fills the store is `manaweb-artwork`; the index it publishes is described
//! in `docs/scryfall.md`.

pub mod hash;
pub mod store;

mod error;

// Only where something reaches the engine across a boundary. A native build
// has the crate itself and wants no exported symbols.
#[cfg(target_family = "wasm")]
pub mod wasm;

pub use error::Error;
pub use hash::{Frame, HASHES, Hash, entry, fingerprint};
pub use store::Store;

pub type Result<T> = std::result::Result<T, Error>;
