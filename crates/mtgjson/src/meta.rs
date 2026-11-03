use serde::Deserialize;

/// Which build the files were cut from.
///
/// MTGJSON publishes `Meta.json` beside the tables and repeats the same pair
/// inside `data`, so either half answers it.
#[derive(Debug, Clone, Deserialize)]
pub struct Meta {
    /// `YYYY-MM-DD`. Builds land daily and there are no deltas.
    pub date: String,
    /// Semver plus the build date, as `5.3.0+20261103`.
    pub version: String,
}

impl Meta {
    /// Reads the outer object, whose `meta` key holds the pair.
    ///
    /// # Errors
    ///
    /// Fails if the document isn't the shape `Meta.json` has.
    pub fn parse(json: &str) -> serde_json::Result<Self> {
        #[derive(Deserialize)]
        struct Document {
            meta: Meta,
        }
        serde_json::from_str::<Document>(json).map(|document| document.meta)
    }
}
