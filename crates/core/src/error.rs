#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),

    #[error("applying migrations failed")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("reading the card stream failed")]
    Scryfall(#[from] manaweb_scryfall::Error),

    /// A full replace that wrote nothing would empty the catalog, so the
    /// transaction rolls back instead.
    #[error("the card stream yielded no usable cards, so nothing was replaced")]
    EmptySync,

    #[error("serializing the catalog failed")]
    Json(#[from] serde_json::Error),

    #[error("writing the catalog failed")]
    Io(#[from] std::io::Error),

    #[error("no bulk file has been synced, so there is no catalog to serve")]
    EmptyCatalog,

    /// The client walks the printings file in runs of `printings` per card, so
    /// a disagreement would shift every card after the first bad one.
    #[error("cards claim {claimed} printings but {written} were written")]
    CatalogRuns { claimed: usize, written: usize },

    /// Written at sync, so a printing without it means the cache predates the
    /// column and nothing has refreshed it since.
    #[error("a printing has no export order, so the cache wants re-syncing")]
    CatalogOrder,
}
