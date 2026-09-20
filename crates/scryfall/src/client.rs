use futures_util::TryStreamExt as _;
use reqwest::header::ACCEPT;
use tokio_util::io::StreamReader;

use crate::{BulkData, BulkIndex, BulkKind, CardStream, Error, Result};

const API: &str = "https://api.scryfall.com";

/// The `User-Agent` Scryfall's terms ask for: the app's own, not a library's.
///
/// Built from the crate version, so a release cannot leave it behind.
pub const USER_AGENT: &str = concat!(
    "Manaweb/",
    env!("CARGO_PKG_VERSION"),
    " (+https://manaweb.app)"
);

/// A Scryfall HTTP client.
///
/// There is no `Default`: Scryfall's terms require a `User-Agent` of the
/// calling app's own.
#[derive(Debug, Clone)]
pub struct Client {
    http: reqwest::Client,
    api: String,
}

impl Client {
    /// # Errors
    ///
    /// Fails if the user agent isn't a valid header value, or the TLS backend
    /// won't initialize.
    pub fn new(user_agent: &str) -> Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder().user_agent(user_agent).build()?,
            api: API.to_owned(),
        })
    }

    /// Points the client at another API base, for tests.
    #[must_use]
    pub fn with_api(mut self, base: impl Into<String>) -> Self {
        self.api = base.into();
        self
    }

    /// # Errors
    ///
    /// Fails on a request error or an index that doesn't parse.
    pub async fn bulk_index(&self) -> Result<BulkIndex> {
        Ok(self
            .http
            .get(format!("{}/bulk-data", self.api))
            // Scryfall documents Accept as required and rejects requests
            // without it. Sent explicitly rather than relying on reqwest's
            // `*/*` default happening to satisfy the check.
            .header(ACCEPT, "application/json")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    /// Looks up one file in the index.
    ///
    /// # Errors
    ///
    /// Fails as [`Self::bulk_index`] does, or if the index has no such file.
    pub async fn bulk_data(&self, kind: BulkKind) -> Result<BulkData> {
        self.bulk_index()
            .await?
            .get(kind)
            .cloned()
            .ok_or(Error::NoSuchBulk(kind))
    }

    /// Opens the file as a stream. Nothing is downloaded until it's read.
    ///
    /// # Errors
    ///
    /// Fails if the download can't be started; read errors surface from
    /// [`CardStream::try_next`].
    pub async fn download(&self, bulk: &BulkData) -> Result<CardStream> {
        let body = self
            .http
            .get(&bulk.jsonl_download_uri)
            .send()
            .await?
            .error_for_status()?
            .bytes_stream()
            .map_err(std::io::Error::other);
        Ok(CardStream::gzipped(StreamReader::new(body)))
    }
}
