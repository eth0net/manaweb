// Every variant with a source interpolates it. The weekly refresh runs
// unattended and logs `Display`, so a label alone is a failure nobody can act
// on: which constraint, which card, which errno.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("applying migrations failed: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("reading the card stream failed: {0}")]
    Scryfall(#[from] manaweb_scryfall::Error),

    /// A full replace that wrote nothing would empty the catalog, so the
    /// transaction rolls back instead.
    #[error("the card stream yielded no usable cards, so nothing was replaced")]
    EmptySync,

    #[error("serializing the catalog failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("writing the catalog failed: {0}")]
    Io(#[from] std::io::Error),

    /// No sync yet, or one from before a migration this build carries.
    #[error("the cache holds no sync this build can export")]
    EmptyCatalog,

    /// The client walks the printings file in runs of `printings` per card, so
    /// a disagreement would shift every card after the first bad one.
    #[error("cards claim {claimed} printings but {written} were written")]
    CatalogRuns { claimed: usize, written: usize },

    /// Written at sync, so a printing without it means the cache predates the
    /// column and nothing has refreshed it since.
    #[error("a printing has no export order, so the cache wants re-syncing")]
    CatalogOrder,

    /// The index numbers artworks in a 32-bit column, which four billion of
    /// them would not fit.
    #[error("more artworks than the index can number")]
    CatalogArtworks,
}
