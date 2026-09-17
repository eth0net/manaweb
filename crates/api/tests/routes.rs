//! The health check, and the exported catalog served for local development.

use std::path::PathBuf;
use std::{env, fs};

use axum::body::{Body, to_bytes};
use axum::http::{HeaderValue, Request, Response, StatusCode};
use serde_json::Value;
use tower::ServiceExt as _;

/// A directory of its own per test, since `ServeDir` needs a real one.
fn scratch(name: &str) -> PathBuf {
    let dir = env::temp_dir().join(format!("manaweb-{name}-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

async fn get(catalog: PathBuf, path: &str) -> Response<Body> {
    let pool = manaweb_core::open_memory()
        .await
        .expect("migrations should apply");
    manaweb_api::router(pool, catalog)
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .expect("routing is infallible")
}

async fn body(response: Response<Body>) -> Vec<u8> {
    to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec()
}

#[tokio::test]
async fn health_reports_an_empty_cache_as_empty() {
    let response = get(scratch("health"), "/health").await;
    assert_eq!(response.status(), StatusCode::OK);

    let health: Value = serde_json::from_slice(&body(response).await).unwrap();
    assert_eq!(health["cache"], Value::Null);
}

#[tokio::test]
async fn the_catalog_directory_is_served() {
    let catalog = scratch("catalog");
    fs::write(catalog.join("manifest.json"), br#"{"version":"x"}"#).unwrap();

    let response = get(catalog.clone(), "/catalog/manifest.json").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(response).await, br#"{"version":"x"}"#);

    let missing = get(catalog.clone(), "/catalog/nothing.json").await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    // The prefix is the artifact set, so the root belongs to no set at all.
    let root = get(catalog.clone(), "/manifest.json").await;
    assert_eq!(root.status(), StatusCode::NOT_FOUND);

    fs::remove_dir_all(catalog).unwrap();
}

#[tokio::test]
async fn the_catalog_is_readable_from_another_origin() {
    let catalog = scratch("cors");
    fs::write(catalog.join("manifest.json"), br#"{"version":"x"}"#).unwrap();

    // The app is served from a different host than the catalog, so without
    // this the first fetch fails in the browser and nowhere else.
    let response = get(catalog.clone(), "/catalog/manifest.json").await;
    assert_eq!(
        response.headers().get("access-control-allow-origin"),
        Some(&HeaderValue::from_static("*"))
    );

    fs::remove_dir_all(catalog).unwrap();
}
