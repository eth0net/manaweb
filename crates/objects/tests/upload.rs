//! What actually goes over the wire, against a bucket that is a recording
//! HTTP server rather than R2. Nobody watches the weekly upload, so the
//! headers and the ordering are held here instead.

use std::fs;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::response::Response;
use manaweb_objects::{Bucket, Config};
use tokio::net::TcpListener;

/// One request as the bucket saw it.
#[derive(Debug, Clone)]
struct Seen {
    method: String,
    path: String,
    content_type: String,
    cache_control: String,
}

type Log = Arc<Mutex<Vec<Seen>>>;

/// Answers a HEAD for anything in `holding` and takes every PUT.
async fn bucket(holding: Vec<String>) -> (SocketAddr, Log) {
    holds(holding, String::new()).await
}

/// The same, answering a GET with `body` — what the bucket already holds.
async fn holds(holding: Vec<String>, body: String) -> (SocketAddr, Log) {
    let log: Log = Arc::default();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();

    let state = (log.clone(), holding, body);
    let app =
        axum::Router::new()
            .fallback(
                |State((log, holding, body)): State<(Log, Vec<String>, String)>,
                 request: Request| async move {
                    let head = |name: header::HeaderName| {
                        request
                            .headers()
                            .get(name)
                            .and_then(|one| one.to_str().ok())
                            .unwrap_or_default()
                            .to_owned()
                    };
                    let seen = Seen {
                        method: request.method().to_string(),
                        path: request.uri().path().to_owned(),
                        content_type: head(header::CONTENT_TYPE),
                        cache_control: head(header::CACHE_CONTROL),
                    };
                    let known = holding.iter().any(|one| seen.path.ends_with(one));
                    log.lock().unwrap().push(seen.clone());

                    let status = if seen.method == "HEAD" && !known {
                        StatusCode::NOT_FOUND
                    } else {
                        StatusCode::OK
                    };
                    let sending = if seen.method == "GET" && known {
                        body.clone()
                    } else {
                        String::new()
                    };
                    Response::builder()
                        .status(status)
                        .header(header::CONTENT_LENGTH, sending.len().to_string())
                        .header(header::ETAG, "\"1\"")
                        .header(header::LAST_MODIFIED, "Thu, 17 Sep 2026 12:00:00 GMT")
                        .body(axum::body::Body::from(sending))
                        .unwrap()
                },
            )
            .with_state(state);

    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (address, log)
}

/// A catalog directory as `Catalog::write` leaves one, artwork index and all.
fn exported(dir: &std::path::Path) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join("artwork.ghi.bin"), b"\x00\x01").unwrap();
    std::fs::write(dir.join("cards.abc.json"), b"[1]").unwrap();
    std::fs::write(dir.join("prints.def.json"), b"[2]").unwrap();
    std::fs::write(
        dir.join("manifest.json"),
        br#"{"version":"2026-09-16T21:05:54.709+00:00",
            "artwork":{"name":"artwork.ghi.bin","rows":1,"bytes":2},
            "cards":{"name":"cards.abc.json","rows":1,"bytes":3},
            "prints":{"name":"prints.def.json","rows":1,"bytes":3}}"#,
    )
    .unwrap();
}

fn client(address: SocketAddr) -> Bucket {
    Bucket::new(&Config {
        endpoint: format!("http://{address}"),
        bucket: "manaweb-static".to_owned(),
        key_id: "key".to_owned(),
        secret: "secret".to_owned(),
        region: "auto".to_owned(),
    })
    .unwrap()
}

#[tokio::test]
async fn the_manifest_goes_last_and_is_the_only_one_not_immutable() {
    let dir = std::env::temp_dir().join("manaweb-publish-order");
    exported(&dir);
    let (address, log) = bucket(vec![]).await;

    let done = client(address).upload("catalog", &dir).await.unwrap();

    assert_eq!(
        done.sent,
        [
            "artwork.ghi.bin",
            "cards.abc.json",
            "prints.def.json",
            "manifest.json"
        ]
    );
    assert!(done.held.is_empty());
    assert_eq!(done.version, "2026-09-16T21:05:54.709+00:00");

    let seen = log.lock().unwrap().clone();
    let puts: Vec<_> = seen.iter().filter(|one| one.method == "PUT").collect();

    // The order is the whole point: a manifest landing first would name a
    // pair no client could fetch.
    assert_eq!(
        puts.iter().map(|one| one.path.as_str()).collect::<Vec<_>>(),
        [
            "/manaweb-static/catalog/artwork.ghi.bin",
            "/manaweb-static/catalog/cards.abc.json",
            "/manaweb-static/catalog/prints.def.json",
            "/manaweb-static/catalog/manifest.json",
        ]
    );

    // A CDN picks its compression from the type, so hashes labeled as text
    // are run through brotli every miss for nothing.
    assert_eq!(puts[0].content_type, "application/octet-stream");
    for one in &puts[1..] {
        assert_eq!(one.content_type, "application/json", "{}", one.path);
    }
    for one in &puts[..3] {
        assert!(one.cache_control.contains("immutable"), "{}", one.path);
    }
    assert_eq!(puts[3].cache_control, "no-cache");
}

// The service uploads at startup as well as after a sync, and a prune reads
// how long the manifest has stood, so a restart must not rewrite it.
#[tokio::test]
async fn a_set_that_has_not_moved_rewrites_nothing_at_all() {
    let dir = std::env::temp_dir().join("manaweb-publish-settled");
    exported(&dir);
    let same = fs::read_to_string(dir.join("manifest.json")).unwrap();
    let (address, seen) = holds(
        vec![
            "artwork.ghi.bin".to_owned(),
            "cards.abc.json".to_owned(),
            "prints.def.json".to_owned(),
            "manifest.json".to_owned(),
        ],
        same,
    )
    .await;

    let done = client(address).upload("catalog", &dir).await.unwrap();

    assert!(done.sent.is_empty(), "sent: {:?}", done.sent);
    assert_eq!(done.held.len(), 4);
    assert!(
        !seen.lock().unwrap().iter().any(|one| one.method == "PUT"),
        "a settled set is read, never written"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_pair_already_there_is_not_sent_again() {
    let dir = std::env::temp_dir().join("manaweb-publish-held");
    exported(&dir);
    let (address, log) = bucket(vec!["cards.abc.json".to_owned()]).await;

    let done = client(address).upload("catalog", &dir).await.unwrap();

    assert_eq!(done.held, ["cards.abc.json"]);
    assert_eq!(
        done.sent,
        ["artwork.ghi.bin", "prints.def.json", "manifest.json"]
    );

    let seen = log.lock().unwrap().clone();
    assert!(
        !seen
            .iter()
            .any(|one| one.method == "PUT" && one.path.ends_with("cards.abc.json")),
        "a content-addressed name that is already there holds the same bytes"
    );
}

// Sets still to be designed will carry fields this one has never seen.
#[tokio::test]
async fn a_manifest_field_that_is_not_an_entry_is_passed_over() {
    let dir = std::env::temp_dir().join("manaweb-publish-extra");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("cards.abc.json"), b"[1]").unwrap();
    std::fs::write(
        dir.join("manifest.json"),
        br#"{"version":"x","builtAt":"2026-09-18T00:00:00Z","count":1,
            "cards":{"name":"cards.abc.json","rows":1,"bytes":3}}"#,
    )
    .unwrap();
    let (address, _) = bucket(vec![]).await;

    let done = client(address).upload("catalog", &dir).await.unwrap();

    assert_eq!(done.sent, ["cards.abc.json", "manifest.json"]);
    fs::remove_dir_all(dir).unwrap();
}

// Passing it over would send a manifest naming a file that never went up.
#[tokio::test]
async fn an_entry_naming_no_file_is_refused_rather_than_passed_over() {
    let dir = std::env::temp_dir().join("manaweb-publish-typo");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("cards.abc.json"), b"[1]").unwrap();
    std::fs::write(
        dir.join("manifest.json"),
        br#"{"version":"x","cards":{"nme":"cards.abc.json","rows":1}}"#,
    )
    .unwrap();
    let (address, seen) = bucket(vec![]).await;

    let error = client(address).upload("catalog", &dir).await.unwrap_err();

    assert!(error.to_string().contains("gives `cards` no `name`"));
    assert!(
        seen.lock().unwrap().is_empty(),
        "nothing should have gone up"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_directory_with_no_manifest_says_so_rather_than_uploading_nothing() {
    let dir = std::env::temp_dir().join("manaweb-publish-empty");
    std::fs::create_dir_all(&dir).unwrap();
    let _ = std::fs::remove_file(dir.join("manifest.json"));
    let (address, _) = bucket(vec![]).await;

    let error = client(address).upload("catalog", &dir).await.unwrap_err();
    assert!(error.to_string().contains("manifest.json"), "{error}");
}
