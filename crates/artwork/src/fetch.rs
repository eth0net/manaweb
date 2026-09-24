//! Pulling artwork images, politely, and keeping them.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::time::{Instant, sleep_until};

use crate::{Artwork, Result};

/// Scryfall asks for 50-100ms between requests; the slower end of what they
/// ask, because nothing here is waiting on the answer.
pub const DELAY: Duration = Duration::from_millis(100);

/// A throttled image fetcher backed by a directory.
///
/// Every image it has already pulled is read from disk, so a rebuild costs
/// the hashing and not the download.
#[derive(Debug)]
pub struct Fetcher {
    http: reqwest::Client,
    dir: PathBuf,
    /// When the next request may go out, rather than a sleep after each: a
    /// cache hit shouldn't pay for a request it never made.
    next: Instant,
}

impl Fetcher {
    /// # Errors
    ///
    /// Fails if the user agent isn't a valid header value, or the TLS backend
    /// won't initialize.
    pub fn new(dir: impl Into<PathBuf>) -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .user_agent(manaweb_scryfall::USER_AGENT)
                .build()?,
            dir: dir.into(),
            next: Instant::now(),
        })
    }

    /// The artwork's image bytes, from disk if they are there.
    ///
    /// # Errors
    ///
    /// Fails on a request error, a refusal from Scryfall, or a directory it
    /// can't write.
    pub async fn get(&mut self, artwork: &Artwork) -> Result<Vec<u8>> {
        let path = self.path(artwork);
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return Ok(bytes);
        }

        self.fetch(&artwork.art_crop(), &path).await
    }

    /// Any image, at the same throttle, kept at `path`.
    ///
    /// # Errors
    ///
    /// Fails on a request error, a refusal from Scryfall, or a directory it
    /// can't write.
    pub async fn fetch(&mut self, url: &str, path: &Path) -> Result<Vec<u8>> {
        sleep_until(self.next).await;
        self.next = Instant::now() + DELAY;

        let bytes = self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        // Named for its own content's source, so a half-written file from an
        // interrupted run can't be read back as a whole one.
        let partial = path.with_extension("part");
        tokio::fs::write(&partial, &bytes).await?;
        tokio::fs::rename(&partial, path).await?;

        Ok(bytes.to_vec())
    }

    /// Whether the image is already on disk.
    #[must_use]
    pub fn holds(&self, artwork: &Artwork) -> bool {
        self.path(artwork).exists()
    }

    /// Two levels of fan-out, so no directory holds fifty thousand entries.
    #[must_use]
    pub fn path(&self, artwork: &Artwork) -> PathBuf {
        let id = &artwork.id;
        Path::new(&self.dir)
            .join(&id[0..2])
            .join(&id[2..4])
            .join(format!("{id}.jpg"))
    }
}
