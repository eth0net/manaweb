//! The Manaweb server: it keeps the card cache fresh and exports the
//! catalog built from it.
//!
//! Nothing here is browser-facing in production: the catalog is uploaded to
//! object storage on its own origin and the app deploys from the repo. The
//! export directory is served for local development. No write handlers, ever:
//! user data lives in the user's own PDS and the browser writes there
//! directly. See `docs/architecture.md`.
//!
//! Configured entirely from the environment:
//!
//! | Variable | Default |
//! |---|---|
//! | `MANAWEB_DATABASE` | `manaweb.db` |
//! | `MANAWEB_CATALOG` | `catalog` |
//! | `MANAWEB_BIND` | `127.0.0.1:8080` |
//! | `MANAWEB_SYNC` | `1` |
//!
//! The bucket it uploads to is configured too, in `manaweb-objects`.

use std::error::Error;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::{env, process};

use manaweb_core::{cards, catalog};
use manaweb_objects::Bucket;
use manaweb_scryfall::{BulkKind, Client, USER_AGENT};
use sqlx::SqlitePool;
use tokio::net::TcpListener;
use tokio::time::sleep;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

/// Which artifact set the catalog is, in the bucket.
const CATALOG: &str = "catalog";

/// Scryfall asks for gameplay data no more than once a week.
const REFRESH: Duration = Duration::from_hours(7 * 24);

/// How soon a failed refresh is tried again, doubling up to [`RETRY_MAX`].
///
/// A migration's new column reaches nobody until a sync lands, so falling
/// straight back to the weekly cadence leaves it unpublished for a week.
const RETRY: Duration = Duration::from_mins(5);

/// Far enough apart that a Scryfall outage costs a handful of 78MB downloads
/// a day rather than a steady stream of them.
const RETRY_MAX: Duration = Duration::from_hours(6);

/// What `manaweb <command>` takes. The image's entrypoint is the binary and
/// its command is `serve`, so a one-off reaches the same binary without the
/// operator knowing where it lives.
const USAGE: &str = "usage: manaweb [serve|health|version]";

/// How long the health check waits. A server that has not answered by then is
/// unhealthy whatever it is doing.
const PATIENCE: Duration = Duration::from_secs(2);

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    match env::args().nth(1).as_deref() {
        None | Some("serve") => {}
        Some("health") => {
            if let Err(error) = health().await {
                eprintln!("{error}");
                process::exit(1);
            }
            return;
        }
        Some("version" | "--version" | "-V") => {
            println!("manaweb {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        Some("help" | "--help" | "-h") => {
            println!("{USAGE}");
            return;
        }
        Some(other) => {
            eprintln!("unknown command: {other}\n{USAGE}");
            process::exit(2);
        }
    }

    if let Err(error) = run().await {
        tracing::error!("{error}");
        process::exit(1);
    }
}

/// Asks the running server whether it is well, so the image can check itself
/// without carrying a second HTTP client to do it with.
async fn health() -> Result<(), Box<dyn Error>> {
    let bind = var("MANAWEB_BIND", "127.0.0.1:8080");
    let bind: SocketAddr = bind.parse().map_err(|_| format!("MANAWEB_BIND: {bind}"))?;

    // Listening on every interface says nothing about which one to ask, and
    // from in here the answer is always the loopback.
    let ip = match bind.ip() {
        IpAddr::V4(held) if held.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(held) if held.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        held => held,
    };

    let client = reqwest::Client::builder().timeout(PATIENCE).build()?;
    let response = client
        .get(format!(
            "http://{}/health",
            SocketAddr::new(ip, bind.port())
        ))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(format!("{status}: {}", body.trim()).into());
    }
    println!("{}", body.trim());
    Ok(())
}

async fn run() -> Result<(), Box<dyn Error>> {
    let settings = Settings::from_env()?;
    let pool = manaweb_core::open(&settings.database).await?;

    // A restart shouldn't wait on a sync, so the catalog comes from whatever
    // the cache already holds.
    match export(&pool, &settings.catalog).await {
        Ok(version) => {
            tracing::info!(%version, "catalog written");
            if let Err(error) = settings.upload().await {
                tracing::error!("{error}");
            }
        }
        Err(error) => tracing::warn!("no catalog yet: {error}"),
    }

    if settings.sync {
        tokio::spawn(refresh_weekly(pool.clone(), settings.clone()));
    } else {
        tracing::info!("sync disabled");
    }

    let listener = TcpListener::bind(settings.bind).await?;
    tracing::info!(
        bind = %settings.bind,
        catalog = %settings.catalog.display(),
        "listening"
    );
    axum::serve(
        listener,
        manaweb_api::router(pool, settings.catalog).layer(TraceLayer::new_for_http()),
    )
    .with_graceful_shutdown(shutdown())
    .await?;

    Ok(())
}

/// Builds the catalog from the cache and writes it out for upload.
async fn export(pool: &SqlitePool, dir: &Path) -> manaweb_core::Result<String> {
    let built = catalog::build(pool).await?;
    built.write(dir).await?;
    tracing::info!(
        cards = built.cards.rows,
        prints = built.prints.rows,
        bytes = built.cards.json.len() + built.prints.json.len(),
        "catalog built"
    );
    Ok(built.version)
}

async fn shutdown() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!("could not listen for shutdown: {error}");
    }
}

/// Checks the bulk index now and weekly after, syncing when the file has
/// changed and republishing the catalog when it has.
async fn refresh_weekly(pool: SqlitePool, settings: Settings) {
    let client = match Client::new(USER_AGENT) {
        Ok(client) => client,
        Err(error) => {
            tracing::error!("no Scryfall client, so no sync: {error}");
            return;
        }
    };

    // Nothing waits before the first attempt, so a restart re-syncs at once.
    let mut wait = Duration::ZERO;
    loop {
        sleep(wait).await;
        wait = match refresh(&pool, &settings, &client).await {
            Ok(()) => REFRESH,
            Err(error) => {
                // The uploaded catalog is untouched, so a failed refresh is a
                // warning rather than a reason to stop.
                tracing::error!("refresh failed: {error}");
                (wait * 2).clamp(RETRY, RETRY_MAX)
            }
        };
    }
}

async fn refresh(
    pool: &SqlitePool,
    settings: &Settings,
    client: &Client,
) -> Result<(), Box<dyn Error>> {
    let bulk = client.bulk_data(BulkKind::DefaultCards).await?;
    if cards::last_synced(pool, &bulk.kind).await?.as_deref() == Some(&bulk.updated_at) {
        tracing::info!(version = %bulk.updated_at, "cache is current");
    } else {
        tracing::info!(version = %bulk.updated_at, size = bulk.compressed_size, "syncing");
        let mut stream = client.download(&bulk).await?;
        let report = cards::replace(pool, &bulk, &mut stream).await?;
        tracing::info!(
            printings = report.written,
            cards = report.cards,
            skipped = report.skipped,
            "synced"
        );
    }

    // Outside the check above, because what it answers is whether the cache
    // is current and what has to be true is that the bucket is. An upload
    // that failed after its sync committed would otherwise wait for Scryfall
    // to publish again before anything tried it a second time. Sending what
    // the bucket already holds costs a listing.
    export(pool, &settings.catalog).await?;
    settings.upload().await?;

    Ok(())
}

#[derive(Debug, Clone)]
struct Settings {
    database: String,
    /// Where the catalog is written: what gets uploaded, and what the dev
    /// server serves.
    catalog: PathBuf,
    bind: SocketAddr,
    sync: bool,
    /// Where a written catalog goes. Unconfigured leaves it on disk, which
    /// is what local development wants.
    bucket: Option<Bucket>,
}

impl Settings {
    fn from_env() -> Result<Self, Box<dyn Error>> {
        let bind = var("MANAWEB_BIND", "127.0.0.1:8080");
        Ok(Self {
            database: var("MANAWEB_DATABASE", "manaweb.db"),
            catalog: PathBuf::from(var("MANAWEB_CATALOG", "catalog")),
            bind: bind.parse().map_err(|_| format!("MANAWEB_BIND: {bind}"))?,
            sync: !matches!(var("MANAWEB_SYNC", "1").as_str(), "0" | "false"),
            bucket: Bucket::from_env()?,
        })
    }

    /// Takes away what the last upload replaced, then sends a written catalog
    /// to the bucket, if there is one.
    async fn upload(&self) -> Result<(), Box<dyn Error>> {
        let Some(bucket) = &self.bucket else {
            return Ok(());
        };

        // Before the upload: what the manifest names now is what a client is
        // fetching now, so this can only reach what the last upload replaced.
        let swept = bucket.prune(CATALOG).await?;
        tracing::info!(
            removed = swept.removed.len(),
            kept = swept.kept.len(),
            "catalog pruned"
        );

        let done = bucket.upload(CATALOG, &self.catalog).await?;
        tracing::info!(
            version = %done.version,
            sent = done.sent.len(),
            held = done.held.len(),
            "catalog uploaded"
        );
        Ok(())
    }
}

fn var(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_owned())
}
