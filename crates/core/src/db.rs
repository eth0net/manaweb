use std::path::Path;
use std::str::FromStr as _;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

static MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// The migration the cache has to have been synced under.
///
/// A migration can add a column nothing but a sync fills, so one that has not
/// run since is holding a gap the export would publish.
pub(crate) fn schema() -> i64 {
    MIGRATIONS
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or_default()
}

/// Opens the database at `path`, creating it if absent, and migrates it.
///
/// # Errors
///
/// Fails if the file can't be opened or a migration doesn't apply.
pub async fn open(path: impl AsRef<Path>) -> crate::Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        // A weekly sync holds a long write transaction; WAL keeps readers on
        // the previous catalog until it commits.
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true);

    connect(options).await
}

/// Opens an in-memory database, for tests and the dev CLI.
///
/// # Errors
///
/// Fails if a migration doesn't apply.
pub async fn open_memory() -> crate::Result<SqlitePool> {
    // Every connection to `:memory:` gets a database of its own, so the pool
    // holds exactly one or callers would see different data per query.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::from_str("sqlite::memory:")?)
        .await?;
    MIGRATIONS.run(&pool).await?;
    Ok(pool)
}

/// Connects with caller-supplied options and migrates.
///
/// # Errors
///
/// Fails if the connection can't be made or a migration doesn't apply.
pub async fn connect(options: SqliteConnectOptions) -> crate::Result<SqlitePool> {
    let pool = SqlitePool::connect_with(options).await?;
    MIGRATIONS.run(&pool).await?;
    Ok(pool)
}
