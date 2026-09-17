//! The S3-compatible bucket every static artifact of ours is served from.
//!
//! An *artifact set* is a directory holding a `manifest.json` and the files it
//! names, each under its own prefix in the bucket: the catalog today, a
//! scanner index and precomputed recommendations later. Uploading is the only
//! operation so far.
//!
//! Configured entirely from the environment, and unconfigured means nothing
//! is uploaded:
//!
//! | Variable | Default |
//! |---|---|
//! | `MANAWEB_S3_ENDPOINT` | unset |
//! | `MANAWEB_S3_BUCKET` | unset |
//! | `MANAWEB_S3_KEY_ID` | unset |
//! | `MANAWEB_S3_SECRET` | unset |
//! | `MANAWEB_S3_REGION` | `auto` |

use std::collections::BTreeMap;
use std::env;
use std::path::Path;
use std::sync::Arc;

use object_store::aws::{AmazonS3, AmazonS3Builder};
use object_store::path::Path as Key;
use object_store::{
    Attribute, AttributeValue, Attributes, ObjectStore, ObjectStoreExt as _, PutOptions, PutPayload,
};
use serde::Deserialize;
use serde_json::Value;

/// Content-addressed files are never rewritten under the same name.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// The manifest is the only part a client re-reads, so it must not be held.
const REVALIDATE: &str = "no-cache";

const MANIFEST: &str = "manifest.json";
const JSON: &str = "application/json";

/// R2 has no regions, and signing still wants one.
const REGION: &str = "auto";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0} is set, so {1} must be too")]
    Partial(&'static str, &'static str),
    #[error("object storage: {0}")]
    Storage(#[from] object_store::Error),
    #[error("{0}: {1}")]
    Read(String, #[source] std::io::Error),
    #[error("{MANIFEST} does not parse: {0}")]
    Manifest(#[from] serde_json::Error),
    #[error("{MANIFEST} gives `{0}` no `name`, so there is no file to send")]
    Part(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Where a bucket is and what opens it.
#[derive(Debug, Clone)]
pub struct Config {
    pub endpoint: String,
    pub bucket: String,
    pub key_id: String,
    pub secret: String,
    /// R2 ignores this; another S3 will not.
    pub region: String,
}

/// What a client fetches first: a version, and an entry per file naming it.
///
/// An entry is an object naming its file; any other field is something else
/// the set carries, and is passed over.
#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    #[serde(flatten)]
    parts: BTreeMap<String, Value>,
}

impl Manifest {
    /// The file each entry names, in a fixed order.
    fn names(&self) -> Result<Vec<String>> {
        self.parts
            .iter()
            .filter(|(_, part)| part.is_object())
            .map(|(field, part)| {
                part.get("name")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| Error::Part(field.clone()))
            })
            .collect()
    }
}

/// One artifact set, as it went up.
#[derive(Debug)]
pub struct Uploaded {
    pub version: String,
    /// Named in upload order, the manifest last.
    pub sent: Vec<String>,
    /// Already there under the same name, so not sent again.
    pub held: Vec<String>,
}

/// A bucket to upload artifact sets into.
#[derive(Debug, Clone)]
pub struct Bucket {
    s3: Arc<AmazonS3>,
}

impl Bucket {
    /// Reads the configuration, returning `None` when none is set.
    ///
    /// # Errors
    ///
    /// Fails when the configuration is half-written, or the bucket won't
    /// build from it.
    pub fn from_env() -> Result<Option<Self>> {
        let Some(endpoint) = var("MANAWEB_S3_ENDPOINT") else {
            return Ok(None);
        };

        let want =
            |name: &'static str| var(name).ok_or(Error::Partial("MANAWEB_S3_ENDPOINT", name));

        Ok(Some(Self::new(&Config {
            endpoint,
            bucket: want("MANAWEB_S3_BUCKET")?,
            key_id: want("MANAWEB_S3_KEY_ID")?,
            secret: want("MANAWEB_S3_SECRET")?,
            region: var("MANAWEB_S3_REGION").unwrap_or_else(|| REGION.to_owned()),
        })?))
    }

    /// # Errors
    ///
    /// Fails if a bucket won't build from these.
    pub fn new(config: &Config) -> Result<Self> {
        Ok(Self {
            s3: Arc::new(
                AmazonS3Builder::new()
                    .with_endpoint(&config.endpoint)
                    // Naming a plain-http endpoint is how you ask for one.
                    .with_allow_http(config.endpoint.starts_with("http://"))
                    .with_bucket_name(&config.bucket)
                    .with_access_key_id(&config.key_id)
                    .with_secret_access_key(&config.secret)
                    .with_region(&config.region)
                    .build()?,
            ),
        })
    }

    /// Uploads the pair the manifest names, then the manifest.
    ///
    /// The manifest goes last, so it never names an object that has not
    /// landed. A name already present is skipped rather than rewritten.
    ///
    /// # Errors
    ///
    /// Fails if the directory has no readable manifest, if it names a file it
    /// does not hold, or if an upload is refused.
    pub async fn upload(&self, prefix: &str, dir: &Path) -> Result<Uploaded> {
        let manifest = read(&dir.join(MANIFEST)).await?;
        let named: Manifest = serde_json::from_slice(&manifest)?;

        let mut sent = Vec::new();
        let mut held = Vec::new();
        for name in named.names()? {
            let key = key(prefix, &name);
            if self.s3.head(&key).await.is_ok() {
                held.push(name);
                continue;
            }
            let body = read(&dir.join(&name)).await?;
            self.put(&key, body, IMMUTABLE).await?;
            sent.push(name);
        }

        self.put(&key(prefix, MANIFEST), manifest, REVALIDATE)
            .await?;
        sent.push(MANIFEST.to_owned());

        Ok(Uploaded {
            version: named.version,
            sent,
            held,
        })
    }

    async fn put(&self, key: &Key, body: Vec<u8>, cache: &str) -> Result<()> {
        let bytes = body.len();
        let mut attributes = Attributes::new();
        attributes.insert(Attribute::ContentType, AttributeValue::from(JSON));
        attributes.insert(
            Attribute::CacheControl,
            AttributeValue::from(cache.to_owned()),
        );

        let options = PutOptions {
            attributes,
            ..PutOptions::default()
        };
        self.s3
            .put_opts(key, PutPayload::from(body), options)
            .await?;
        tracing::debug!(%key, bytes, "uploaded");
        Ok(())
    }
}

/// Each set lives under its own prefix, so two of them can both call the file
/// a client reads first `manifest.json`.
fn key(prefix: &str, name: &str) -> Key {
    let prefix = prefix.trim_matches('/');
    if prefix.is_empty() {
        Key::from(name)
    } else {
        Key::from(format!("{prefix}/{name}"))
    }
}

async fn read(path: &Path) -> Result<Vec<u8>> {
    tokio::fs::read(path)
        .await
        .map_err(|error| Error::Read(path.display().to_string(), error))
}

fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|one| !one.is_empty())
}
