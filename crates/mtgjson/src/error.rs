#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("mtgjson request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("reading the table failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("the build stamp did not parse: {0}")]
    Meta(#[source] serde_json::Error),

    /// Carries the row so one bad record is findable in a table of a hundred
    /// thousand. Data rows only — the header is not counted, so this is one
    /// short of the line of the file.
    #[error("row {row} did not parse: {source}")]
    Row {
        row: u64,
        #[source]
        source: csv_async::Error,
    },
}
