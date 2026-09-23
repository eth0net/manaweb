#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// Every byte past the header is a valid hash, so a store this build
    /// cannot place is refused rather than read as retrievals.
    #[error("the artwork hash store is unreadable: {0}")]
    Store(&'static str),
}
