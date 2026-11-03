use futures_util::TryStreamExt as _;
use serde::de::DeserializeOwned;
use tokio_util::io::StreamReader;

use crate::{Error, Meta, Result, Rows, Table};

const API: &str = "https://mtgjson.com/api/v5";

/// The `User-Agent` sent to MTGJSON: the app's own, not a library's.
///
/// Built from the crate version, so a release cannot leave it behind.
pub const USER_AGENT: &str = concat!(
    "Manaweb/",
    env!("CARGO_PKG_VERSION"),
    " (+https://manaweb.app)"
);

/// An MTGJSON HTTP client.
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

    /// Which build the files are currently cut from.
    ///
    /// # Errors
    ///
    /// Fails on a request error or a stamp that doesn't parse.
    pub async fn meta(&self) -> Result<Meta> {
        let body = self
            .http
            .get(format!("{}/Meta.json", self.api))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        Meta::parse(&body).map_err(Error::Meta)
    }

    /// The digest beside a table, which is how a refresh decides whether to
    /// pull at all.
    ///
    /// A few hundred bytes against the table's megabytes, and sealed data
    /// changes far less often than the daily build it ships in.
    ///
    /// # Errors
    ///
    /// Fails on a request error.
    pub async fn digest(&self, table: Table) -> Result<String> {
        Ok(self
            .http
            .get(format!("{}/csv/{table}.csv.gz.sha256", self.api))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?
            .trim()
            .to_owned())
    }

    /// Opens a table as a stream. Nothing is downloaded until it's read.
    ///
    /// The row type is the caller's, since [`Table`] and the shape it parses
    /// into are chosen together: [`crate::Product`] for
    /// [`Table::SealedProducts`], [`crate::Deck`] for [`Table::SetDecks`],
    /// [`crate::Identity`] for either identifier table.
    ///
    /// # Errors
    ///
    /// Fails if the download can't be started; read errors surface from
    /// [`Rows::try_next`].
    pub async fn download<T>(&self, table: Table) -> Result<Rows<T>>
    where
        T: DeserializeOwned + Send + 'static,
    {
        let body = self
            .http
            .get(format!("{}/csv/{table}.csv.gz", self.api))
            .send()
            .await?
            .error_for_status()?
            .bytes_stream()
            .map_err(std::io::Error::other);
        Ok(Rows::gzipped(StreamReader::new(body)))
    }
}
