//! Filling in the artworks a store does not hold yet, a capped run at a time.
//!
//! The builder is for the first store and this is for every one after it: a
//! set released since costs a few hundred images rather than the four
//! gigabytes a rebuild would pull — see `docs/scanner.md`.

use manaweb_scanner::hash::{HASHES, Hash};
use manaweb_scanner::{Store, store};
use sqlx::SqlitePool;

use crate::Result;
use crate::artwork::{self, Artwork};
use crate::fetch::Fetcher;
use crate::luma::Plane;

/// What one run did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Filled {
    /// Artworks hashed into the store.
    pub added: usize,
    /// Artworks it still does not hold, after this run's cap.
    pub waiting: usize,
    /// Images that would not fetch or would not decode, which are skipped
    /// rather than retried: the next run asks for them again anyway.
    pub failed: usize,
}

/// Asks for up to `cap` artworks the cache names and `store` lacks.
///
/// Stops at the cap rather than at the end, so an empty store converges over
/// weeks instead of pulling every image at once. The store is left untouched
/// where nothing was added, so a caller can tell whether to write it back.
///
/// # Errors
///
/// Fails on a database error, or if no HTTP client can be built. A single
/// image that will not fetch or decode is counted, not raised.
pub async fn fill(pool: &SqlitePool, store: &mut Store, cap: usize) -> Result<Filled> {
    let mut done = Filled::default();
    if cap == 0 {
        return Ok(done);
    }

    let wanted = missing(artwork::all(pool).await?, store);
    if wanted.is_empty() {
        return Ok(done);
    }

    // Built here rather than passed in: nothing on the server keeps images,
    // so the directory a fetcher wants is one it never writes to.
    let mut fetcher = Fetcher::new(".")?;

    for artwork in &wanted {
        if spent(&done, cap) {
            break;
        }
        let Some(id) = store::uuid(&artwork.id) else {
            continue;
        };
        let found = match fetcher.bytes(artwork).await {
            Ok(bytes) => hashes(&bytes),
            Err(error) => {
                tracing::warn!(artwork = artwork.id, "{error}");
                None
            }
        };
        if let Some(found) = found {
            store.insert(id, found);
            done.added += 1;
        } else {
            // Asked for again next run: an image Scryfall was slow about and
            // one that will never decode look the same from here.
            tracing::warn!(artwork = artwork.id, "no hashes from it");
            done.failed += 1;
        }
    }

    done.waiting = wanted.len() - done.added;
    Ok(done)
}

/// Whether a run has asked for as many artworks as it may.
///
/// Asked for rather than brought back: an artwork Scryfall has no image for
/// fails every week, and a cap counting only what landed would let a run of
/// those walk the whole backlog.
#[must_use]
pub fn spent(done: &Filled, cap: usize) -> bool {
    done.added + done.failed >= cap
}

/// The artworks the cache names that `store` has no hashes for, in the order
/// the cache enumerates them so two runs agree about what comes next.
#[must_use]
pub fn missing(artworks: Vec<Artwork>, store: &Store) -> Vec<Artwork> {
    artworks
        .into_iter()
        .filter(|held| store::uuid(&held.id).is_some_and(|id| store.get(&id).is_none()))
        .collect()
}

/// One image's hashes, or `None` where it will not decode.
#[must_use]
pub fn hashes(bytes: &[u8]) -> Option<[Hash; HASHES]> {
    let image = image::load_from_memory(bytes).ok()?;
    Plane::new(&image)
        .frame()
        .as_ref()
        .map(manaweb_scanner::entry)
}
