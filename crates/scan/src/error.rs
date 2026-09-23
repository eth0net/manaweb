#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),

    #[error("fetching an image failed")]
    Http(#[from] reqwest::Error),

    #[error("decoding an image failed")]
    Image(#[from] image::ImageError),

    #[error("reading or writing the image cache failed")]
    Io(#[from] std::io::Error),
}
