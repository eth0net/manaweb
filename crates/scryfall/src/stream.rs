use std::fmt;

use async_compression::tokio::bufread::GzipDecoder;
use tokio::io::{AsyncBufRead, AsyncBufReadExt as _, AsyncRead, AsyncReadExt as _, BufReader};

use crate::{Card, Error, Result};

/// A newline-delimited JSON card file, read a line at a time.
///
/// Default Cards is ~78MB compressed and several times that decompressed, so it
/// is never held whole.
pub struct CardStream {
    reader: Box<dyn AsyncBufRead + Send + Unpin>,
    line: u64,
}

/// What one line may weigh before the read gives up.
///
/// A card record is a few kilobytes. Without a ceiling, a file that arrives
/// with no newline in it is read into one allocation, which on the box this
/// runs on is the cheapest way to end the process.
const LINE: u64 = 1 << 20;

impl CardStream {
    /// Reads already-decompressed NDJSON.
    #[must_use]
    pub fn new<R: AsyncBufRead + Send + Unpin + 'static>(reader: R) -> Self {
        Self {
            reader: Box::new(reader),
            line: 0,
        }
    }

    /// Reads the gzip that Scryfall serves.
    ///
    /// Multi-member, so a concatenated file decodes whole rather than stopping
    /// silently at the end of the first member.
    #[must_use]
    pub fn gzipped<R: AsyncRead + Send + Unpin + 'static>(reader: R) -> Self {
        let mut gzip = GzipDecoder::new(BufReader::new(reader));
        gzip.multiple_members(true);
        Self::new(BufReader::new(gzip))
    }

    /// The next card, or `None` at end of file.
    ///
    /// # Errors
    ///
    /// Fails on an unreadable stream, or on a line that isn't a card object.
    /// The error names the line, and the stream can be polled again to skip it.
    pub async fn try_next(&mut self) -> Result<Option<Card>> {
        loop {
            let Some(line) = self.next_line().await? else {
                return Ok(None);
            };
            self.line += 1;
            if line.trim().is_empty() {
                continue;
            }
            return serde_json::from_str(&line)
                .map(Some)
                .map_err(|source| Error::Parse {
                    line: self.line,
                    source,
                });
        }
    }

    /// The next line without its terminator, bounded by [`LINE`].
    async fn next_line(&mut self) -> Result<Option<String>> {
        let mut bytes = Vec::new();
        let read = (&mut self.reader)
            .take(LINE)
            .read_until(b'\n', &mut bytes)
            .await?;

        if read == 0 {
            return Ok(None);
        }
        if bytes.last() != Some(&b'\n') && read as u64 == LINE {
            return Err(Error::Io(std::io::Error::other(format!(
                "line {} is over {LINE} bytes",
                self.line + 1
            ))));
        }
        if bytes.last() == Some(&b'\n') {
            bytes.pop();
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
        }

        Ok(Some(String::from_utf8(bytes).map_err(|invalid| {
            Error::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                invalid,
            ))
        })?))
    }

    /// Lines consumed so far, for progress reporting.
    #[must_use]
    pub fn line(&self) -> u64 {
        self.line
    }
}

impl fmt::Debug for CardStream {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CardStream")
            .field("line", &self.line)
            .finish_non_exhaustive()
    }
}
