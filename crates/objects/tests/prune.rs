//! What a prune takes and what it leaves, against a bucket that is a
//! recording HTTP server rather than R2. It deletes, and the weekly job runs
//! it unwatched, so the listing it asks for is held here too.

use std::fmt::Write as _;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use axum::extract::{Request, State};
use axum::http::{Method, StatusCode, header};
use axum::response::Response;
use manaweb_objects::{Bucket, Config};
use tokio::net::TcpListener;

/// Every request the bucket answered, as method and URI.
type Log = Arc<Mutex<Vec<(String, String)>>>;

/// The keys a `DeleteObjects` call named.
type Deleted = Arc<Mutex<Vec<String>>>;

/// What the handler is given: the log, what the bucket holds, and where to
/// record a delete.
type Holding = (Log, Vec<(&'static str, String)>, Deleted);

/// Older than the grace, so only the manifest decides its fate.
const OLD: &str = "2026-01-01T00:00:00.000Z";

/// Inside the grace, whatever day the test runs.
fn now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

const MANIFEST: &str = r#"{"version":"x",
    "cards":{"name":"cards.new.json"},
    "prints":{"name":"prints.new.json"}}"#;

/// Holds `objects` as `(key, last modified)`, answers the manifest, and takes
/// a delete for anything.
async fn bucket(objects: Vec<(&'static str, String)>) -> (SocketAddr, Log, Deleted) {
    let log: Log = Arc::default();
    let deleted: Deleted = Arc::default();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();

    let state = (log.clone(), objects, deleted.clone());
    let app = axum::Router::new()
        .fallback(
            |State((log, objects, deleted)): State<Holding>, request: Request| async move {
                let uri = request.uri().to_string();
                let method = request.method().clone();
                log.lock().unwrap().push((method.to_string(), uri.clone()));

                // Deletes arrive as one `DeleteObjects` POST carrying the
                // keys, so the body is what says which went.
                if method == Method::POST && uri.contains("delete") {
                    let body = axum::body::to_bytes(request.into_body(), 64 * 1024)
                        .await
                        .unwrap();
                    let asked = String::from_utf8_lossy(&body).to_string();
                    let mut xml =
                        String::from(r#"<?xml version="1.0" encoding="UTF-8"?><DeleteResult>"#);
                    for key in asked
                        .split("<Key>")
                        .skip(1)
                        .filter_map(|one| one.split("</Key>").next())
                    {
                        deleted.lock().unwrap().push(key.to_owned());
                        write!(xml, "<Deleted><Key>{key}</Key></Deleted>").unwrap();
                    }
                    xml.push_str("</DeleteResult>");
                    return Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/xml")
                        .body(axum::body::Body::from(xml))
                        .unwrap();
                }

                // A prefix nothing has published to has no manifest, which
                // is a 404 rather than an empty body.
                if uri.ends_with("manifest.json")
                    && !objects
                        .iter()
                        .any(|(key, _)| key.ends_with("manifest.json"))
                {
                    return Response::builder()
                        .status(StatusCode::NOT_FOUND)
                        .body(axum::body::Body::empty())
                        .unwrap();
                }

                // A listing is a GET on the bucket with the query to say so.
                let body = if uri.contains("list-type=2") {
                    let mut xml = String::from(
                        r#"<?xml version="1.0" encoding="UTF-8"?>
                        <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
                        <Name>manaweb-static</Name><KeyCount>9</KeyCount>
                        <MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>"#,
                    );
                    for (key, modified) in &objects {
                        write!(
                            xml,
                            "<Contents><Key>{key}</Key>\
                             <LastModified>{modified}</LastModified>\
                             <ETag>\"1\"</ETag><Size>3</Size>\
                             <StorageClass>STANDARD</StorageClass></Contents>"
                        )
                        .unwrap();
                    }
                    xml.push_str("</ListBucketResult>");
                    xml
                } else {
                    MANIFEST.to_owned()
                };

                // The manifest's age is what decides whether a sweep takes
                // anything, so it answers with the one the listing gives it.
                let modified = objects
                    .iter()
                    .find(|(key, _)| key.ends_with("manifest.json"))
                    .and_then(|(_, at)| chrono::DateTime::parse_from_rfc3339(at).ok())
                    .map_or_else(
                        || "Thu, 01 Jan 2026 00:00:00 GMT".to_owned(),
                        |at| at.format("%a, %d %b %Y %H:%M:%S GMT").to_string(),
                    );

                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/xml")
                    .header(header::ETAG, "\"1\"")
                    .header(header::LAST_MODIFIED, modified)
                    .body(axum::body::Body::from(body))
                    .unwrap()
            },
        )
        .with_state(state);

    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (address, log, deleted)
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
async fn what_the_manifest_no_longer_names_goes() {
    let (address, _log, deleted) = bucket(vec![
        ("catalog/cards.old.json", OLD.to_owned()),
        ("catalog/cards.new.json", OLD.to_owned()),
        ("catalog/prints.new.json", OLD.to_owned()),
        ("catalog/manifest.json", OLD.to_owned()),
    ])
    .await;

    let done = client(address).prune("catalog").await.unwrap();

    assert_eq!(done.removed, ["cards.old.json"]);
    assert_eq!(
        *deleted.lock().unwrap(),
        ["catalog/cards.old.json"],
        "only the unnamed one"
    );
    assert!(done.kept.contains(&"manifest.json".to_owned()));
}

// An upload that put its files up and then failed to land the manifest leaves
// these behind. Nothing names them and nothing ever will, and a settled
// manifest says the pair a client is reading is not among them.
#[tokio::test]
async fn what_an_upload_left_behind_when_it_never_finished_goes() {
    let (address, _log, deleted) = bucket(vec![
        ("catalog/cards.new.json", OLD.to_owned()),
        ("catalog/prints.new.json", OLD.to_owned()),
        ("catalog/manifest.json", OLD.to_owned()),
        ("catalog/cards.neverlanded.json", now()),
    ])
    .await;

    let done = client(address).prune("catalog").await.unwrap();

    assert_eq!(done.removed, ["cards.neverlanded.json"]);
    assert_eq!(*deleted.lock().unwrap(), ["catalog/cards.neverlanded.json"]);
}

// Without a delimiter the bucket answers with every key under the prefix, so
// a prune of the root would reach the catalog's own files.
#[tokio::test]
async fn the_listing_asks_only_for_what_sits_directly_under_the_prefix() {
    let (address, log, deleted) = bucket(vec![("manifest.json", OLD.to_owned())]).await;

    client(address).prune("").await.unwrap();

    assert!(deleted.lock().unwrap().is_empty());
    assert!(
        !log.lock()
            .unwrap()
            .iter()
            .any(|(m, u)| m == "POST" && u.contains("delete")),
        "nothing to take should ask for nothing"
    );

    let listing = log
        .lock()
        .unwrap()
        .iter()
        .find(|(_, uri)| uri.contains("list-type=2"))
        .map(|(_, uri)| uri.clone())
        .expect("a listing was asked for");
    assert!(
        listing.contains("delimiter=%2F") || listing.contains("delimiter=/"),
        "listing must be delimited: {listing}"
    );
}

// The case the object's own age never covered: a pair live for days, replaced
// while someone is part way through fetching it.
#[tokio::test]
async fn a_manifest_that_only_just_changed_takes_nothing() {
    let (address, _log, deleted) = bucket(vec![
        ("catalog/cards.old.json", OLD.to_owned()),
        ("catalog/prints.old.json", OLD.to_owned()),
        ("catalog/cards.new.json", now()),
        ("catalog/prints.new.json", now()),
        ("catalog/manifest.json", now()),
    ])
    .await;

    let done = client(address).prune("catalog").await.unwrap();

    assert!(done.removed.is_empty(), "removed: {:?}", done.removed);
    assert!(deleted.lock().unwrap().is_empty());
    assert_eq!(done.kept.len(), 5, "everything held until it settles");
}

// The first upload to a bucket has to get past the sweep that makes room for
// it, and there is nothing to make room for yet.
#[tokio::test]
async fn a_prefix_that_holds_nothing_yet_prunes_to_nothing() {
    let (address, _log, deleted) = bucket(vec![]).await;

    let done = client(address).prune("catalog").await.unwrap();

    assert!(done.removed.is_empty());
    assert!(done.kept.is_empty());
    assert!(deleted.lock().unwrap().is_empty(), "nothing to delete");
}
