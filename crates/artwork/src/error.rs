#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("fetching an image failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("decoding an image failed: {0}")]
    Image(#[from] image::ImageError),

    #[error("reading or writing the image cache failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Scanner(#[from] manaweb_scanner::Error),

    /// The sweep restates the detector's checks, so a row asked at the
    /// shipped threshold has to come back saying what the detector said.
    #[error("the sweep no longer agrees with the detector: {0}")]
    Adrift(String),
}
