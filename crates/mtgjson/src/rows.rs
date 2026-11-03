use std::fmt;
use std::marker::PhantomData;
use std::pin::Pin;

use async_compression::tokio::bufread::GzipDecoder;
use futures_util::{Stream, StreamExt as _};
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, BufReader};

use crate::{Error, Result};

/// One CSV table, read a row at a time.
///
/// `cardIdentifiers` is 16.2MB compressed and several times that as text, so
/// it is never held whole.
pub struct Rows<T> {
    inner: Pin<Box<dyn Stream<Item = csv_async::Result<T>> + Send>>,
    row: u64,
    _row: PhantomData<fn() -> T>,
}

impl<T: DeserializeOwned + Send + 'static> Rows<T> {
    /// Reads already-decompressed CSV, header row first.
    #[must_use]
    pub fn new<R: AsyncRead + Send + Unpin + 'static>(reader: R) -> Self {
        let csv = csv_async::AsyncDeserializer::from_reader(reader);
        Self {
            inner: Box::pin(csv.into_deserialize::<T>()),
            row: 0,
            _row: PhantomData,
        }
    }

    /// Reads the gzip that MTGJSON serves.
    ///
    /// Its CRC is the whole integrity check: a truncated download fails to
    /// decode rather than importing half a table, which is why the sidecar
    /// digest is only ever compared and never recomputed.
    #[must_use]
    pub fn gzipped<R: AsyncRead + Send + Unpin + 'static>(reader: R) -> Self {
        let mut gzip = GzipDecoder::new(BufReader::new(reader));
        gzip.multiple_members(true);
        Self::new(BufReader::new(gzip))
    }

    /// The next row, or `None` at end of file.
    ///
    /// # Errors
    ///
    /// Fails on an unreadable stream, or on a row that isn't this table's
    /// shape. The error names the row, which the header is not one of.
    pub async fn try_next(&mut self) -> Result<Option<T>> {
        let Some(row) = self.inner.next().await else {
            return Ok(None);
        };
        self.row += 1;
        row.map(Some).map_err(|source| Error::Row {
            row: self.row,
            source,
        })
    }

    /// Rows consumed so far, for progress reporting.
    #[must_use]
    pub fn row(&self) -> u64 {
        self.row
    }
}

impl<T> fmt::Debug for Rows<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Rows")
            .field("row", &self.row)
            .finish_non_exhaustive()
    }
}
