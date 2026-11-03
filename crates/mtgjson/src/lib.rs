//! A reader for MTGJSON's sealed product, decklist and identifier tables.
//!
//! Scryfall describes cards and never products, so what a pack or precon holds
//! comes from here instead. Fetches one gzipped CSV table at a time, checks it
//! against the sidecar digest and parses each row. No database and no join
//! against the card cache: this layer's whole job is faithful parsing.
//!
//! Reasoning, figures and what the tables cost are in `docs/products.md`.

mod client;
mod contents;
mod deck;
mod error;
mod identity;
mod meta;
mod product;
mod rows;
mod table;

pub use client::{Client, USER_AGENT};
pub use contents::{Chance, Contents, Named, Pack, Piece, Printing, Sealed, Variable};
pub use deck::{Board, Deck};
pub use error::Error;
pub use identity::Identity;
pub use meta::Meta;
pub use product::Product;
pub use rows::Rows;
pub use table::Table;

pub type Result<T> = std::result::Result<T, Error>;
