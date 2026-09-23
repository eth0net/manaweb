//! Holds a deployment to what a browser needs of it. The rules it checks are
//! Cloudflare's — CORS and cache policy set on the bucket's custom domain, and
//! whatever a Pages project answers for a path it doesn't have — so a checkout
//! cannot answer for any of them and neither can a test.

use std::collections::BTreeMap;
use std::error::Error;
use std::ffi::OsStr;

use reqwest::header::{HeaderMap, HeaderValue, ORIGIN, USER_AGENT};
use reqwest::{Client, Method, Response};
use serde::Deserialize;
use serde_json::Value;

/// Cloudflare's browser integrity check answers a bare client with a 403, so
/// this says who it is instead.
const WHO: &str = "manaweb-verify (+https://manaweb.app)";

/// An `Origin` makes the reply carry the CORS headers a browser would get.
const FROM: &str = "https://manaweb.app";

#[derive(Deserialize)]
struct Manifest {
    version: String,
    #[serde(flatten)]
    parts: BTreeMap<String, Value>,
}

impl Manifest {
    /// Every file the manifest names, so a part added to it is checked
    /// without this being touched, and the fields that name none.
    fn names(&self) -> (Vec<String>, Vec<String>) {
        let (mut names, mut wrong) = (Vec::new(), Vec::new());
        for (field, part) in &self.parts {
            if !part.is_object() {
                continue;
            }
            match part.get("name").and_then(Value::as_str) {
                Some(name) => names.push(name.to_owned()),
                None => wrong.push(field.clone()),
            }
        }
        (names, wrong)
    }
}

/// What a file of this name is served as, matching what an upload sets.
fn served_as(name: &str) -> &'static str {
    match std::path::Path::new(name)
        .extension()
        .and_then(OsStr::to_str)
    {
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

/// What was wrong, in the order it was found. Empty is a pass.
#[derive(Debug, Default)]
pub struct Found {
    said: Vec<String>,
    wrong: Vec<String>,
}

impl Found {
    fn ok(&mut self, note: impl Into<String>) {
        self.said.push(note.into());
    }

    fn fail(&mut self, note: impl Into<String>) {
        self.wrong.push(note.into());
    }

    /// Prints what it found and says whether anything is wrong.
    #[must_use]
    pub fn report(&self) -> bool {
        for note in &self.said {
            println!("  ok    {note}");
        }
        for note in &self.wrong {
            println!("  FAIL  {note}");
        }
        println!(
            "{}",
            if self.wrong.is_empty() {
                ""
            } else {
                "\nFAILED"
            }
        );
        self.wrong.is_empty()
    }
}

fn client() -> Result<Client, Box<dyn Error>> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(WHO));
    headers.insert(ORIGIN, HeaderValue::from_static(FROM));
    Ok(Client::builder().default_headers(headers).build()?)
}

fn header(response: &Response, name: &str) -> String {
    response
        .headers()
        .get(name)
        .and_then(|one| one.to_str().ok())
        .unwrap_or_default()
        .to_owned()
}

/// The document is fetched by the URL it claims as its own `client_id`, which
/// is the one thing an authorization server checks before anything else. A
/// single-page fallback answers 200 with HTML for a path it doesn't have, so
/// "did it deploy" and "is it JSON" are one question.
///
/// # Errors
///
/// When the document cannot be reached at all, which a finding about it is
/// not: a 404 is an answer and is reported as one.
pub async fn oauth(url: &str) -> Result<Found, Box<dyn Error>> {
    let mut found = Found::default();
    let response = client()?.get(url).send().await?;

    let status = response.status();
    if status != 200 {
        found.fail(format!("status {status}, must be exactly 200"));
    }

    let kind = header(&response, "content-type");
    if !kind.starts_with("application/json") {
        found.fail(format!("content-type {kind}, must be application/json"));
    }

    let body = response.text().await?;
    match serde_json::from_str::<serde_json::Value>(&body) {
        Err(error) => found.fail(format!("not JSON: {error}")),
        Ok(document) => {
            let client_id = document.get("client_id").and_then(|one| one.as_str());
            if client_id == Some(url) {
                found.ok("served as its own client_id");
            } else {
                found.fail(format!(
                    "client_id is {}, must equal the URL fetched",
                    client_id.unwrap_or("absent")
                ));
            }
        }
    }

    Ok(found)
}

/// The manifest must not be cached and the files it names must be, or a client
/// either never sees a new catalog or pins itself to an old pair.
///
/// # Errors
///
/// When the origin cannot be reached at all — see [`oauth`].
pub async fn catalog(origin: &str) -> Result<Found, Box<dyn Error>> {
    let base = origin.trim_end_matches('/');
    let mut found = Found::default();
    let client = client()?;

    let at = format!("{base}/manifest.json");
    let response = client.get(&at).send().await?;

    let status = response.status();
    if status != 200 {
        found.fail(format!("manifest.json: status {status}, must be 200"));
    }

    let kind = header(&response, "content-type");
    if !kind.starts_with("application/json") {
        found.fail(format!("manifest.json: content-type {kind}"));
    }
    if header(&response, "access-control-allow-origin") != "*" {
        found.fail("manifest.json: no CORS, so every catalog fetch fails in a browser");
    }

    let policy = header(&response, "cache-control");
    if !policy.contains("no-cache") {
        found.fail(format!(
            "manifest.json: cache-control {policy:?}, must be no-cache or a \
             stale one pins the client to an old pair"
        ));
    }

    let body = response.text().await?;
    let named: Manifest = match serde_json::from_str(&body) {
        Ok(named) => named,
        Err(error) => {
            found.fail(format!("manifest.json: not JSON: {error}"));
            return Ok(found);
        }
    };

    let (files, wrong) = named.names();
    for field in wrong {
        // An upload refuses the same manifest, so a check that passed here
        // would be saying the opposite of what publishing does.
        found.fail(format!("manifest.json: {field} names no file"));
    }

    for name in files {
        let response = client
            .request(Method::HEAD, format!("{base}/{name}"))
            .send()
            .await?;

        let status = response.status();
        let policy = header(&response, "cache-control");
        if status != 200 {
            found.fail(format!("{name}: status {status}, named but not served"));
        } else if !policy.contains("immutable") {
            found.fail(format!("{name}: cache-control is not immutable"));
        } else if !header(&response, "content-type").starts_with(served_as(&name)) {
            // A CDN compresses by type, so hashes served as text are run
            // through brotli on every miss for nothing.
            found.fail(format!(
                "{name}: content-type {}, wanted {}",
                header(&response, "content-type"),
                served_as(&name)
            ));
        } else {
            let cached = header(&response, "cf-cache-status");
            found.ok(format!("{name}  cached {cached}"));
        }
    }

    if found.wrong.is_empty() {
        found.ok(format!("{} served", named.version));
    }
    Ok(found)
}
