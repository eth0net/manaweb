//! Shared database models and logic.
//!
//! Deliberately free of atproto dependencies — see `docs/architecture.md`.
//! User data lives in PDSes; this is the card cache and, later, the index over
//! published records.

pub mod cards;
pub mod catalog;
mod db;
mod error;

pub use db::{connect, open, open_memory};
pub use error::Error;

pub type Result<T> = std::result::Result<T, Error>;
