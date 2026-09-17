//! API routes and their handlers. HTTP today because XRPC is, though the
//! transport is incidental: a `subscription` lexicon would be a websocket in
//! here too.
//!
//! A health check, and the exported catalog served for local development —
//! in production the app and the catalog are deployed elsewhere. No write
//! handlers, ever: the browser writes to the user's own PDS. See
//! `docs/architecture.md`.

use std::path::PathBuf;

use axum::Router;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use manaweb_core::cards;
use serde::Serialize;
use sqlx::SqlitePool;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

/// Every route the server answers, with `catalog` served under `/catalog`,
/// where the bucket keeps it.
///
/// Nothing here sets `Cache-Control`: the objects carry their own once
/// uploaded, and a dev server wants none of it.
pub fn router(pool: SqlitePool, catalog: PathBuf) -> Router {
    // The catalog is public data on a different origin from the app, so any
    // origin may read it. Matches what the bucket has to allow in production,
    // and what Scryfall's own API sends.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::HEAD]);

    Router::new()
        .route("/health", get(health))
        .with_state(pool)
        .nest_service("/catalog", ServeDir::new(catalog))
        .layer(cors)
}

#[derive(Debug, Serialize)]
struct Health {
    /// The bulk file the cache holds, absent before the first sync.
    cache: Option<String>,
}

async fn health(State(pool): State<SqlitePool>) -> Response {
    let Ok(cache) = cards::last_synced(&pool, "default_cards").await else {
        // A health check that reports healthy when the database is gone is
        // worse than none.
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "the database is not answering\n",
        )
            .into_response();
    };

    let body = serde_json::to_vec(&Health { cache }).expect("plain data");
    (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "application/json"),
            (CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}
