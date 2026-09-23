use crate::BulkKind;

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("scryfall request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("reading the card stream failed: {0}")]
    Io(#[from] std::io::Error),

    /// Carries the line number so one bad record is findable in a file of a
    /// hundred thousand.
    #[error("card on line {line} did not parse: {source}")]
    Parse {
        line: u64,
        #[source]
        source: serde_json::Error,
    },

    #[error("the bulk-data index has no {0} file")]
    NoSuchBulk(BulkKind),
}
