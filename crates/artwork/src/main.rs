//! Builds and measures the scanner index.
//!
//! Five jobs, split because the pull is hours and the rest is minutes:
//! `pull` fills a directory with artwork images, `hash` turns them into the
//! store the export reads, and `measure` reports what a hash retrieves from a
//! degraded copy of one.
//!
//! The other two ask the question `measure` cannot, which is what a
//! photograph of a card names: `cards` pulls whole-card images to photograph
//! and score against, and `photos` scores a directory of them.
//!
//! Each takes the cache and a directory, then `pull`, `measure` and `cards`
//! take how many to stop at and `hash` takes where the store goes. `refusals`
//! is the exception, taking a directory and nothing else.
//!
//! `MANAWEB_SHOTS` makes `photos` print a row per photograph rather than
//! only the misses, which is what a confidence floor is read off.
//!
//! `refusals` asks nothing of the index at all: only which of the detector's
//! checks turned down each frame in a directory, and what some other
//! threshold would have made of the same ones. `MANAWEB_FRAMES` prints a row
//! per frame, `MANAWEB_MASKS` names a directory to write each flood into.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::ExitCode;

use manaweb_artwork::fetch::Fetcher;
use manaweb_artwork::luma::Plane;
use manaweb_artwork::{Artwork, Error, Result, artwork, degrade, photo};
use manaweb_scanner::art::Rect;
use manaweb_scanner::detect::{self, Reading, Refusal};
use manaweb_scanner::hash::{self, Frame, Hash};
use manaweb_scanner::query;
use manaweb_scanner::{HASHES, Store, store};

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "manaweb_artwork=info".into()),
        )
        .init();

    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_default();

    // Before the cache is opened, and so without the argument naming one: it
    // reads frames off a disk and asks the detector, and a checkout with no
    // database should still be able to run it.
    if command == "refusals" {
        let dir = args.next().unwrap_or_else(|| "photos".into());
        let step = args
            .next()
            .and_then(|held| held.parse().ok())
            .unwrap_or(detect::STEP);
        return refusals(&dir, step);
    }

    let db = args.next().unwrap_or_else(|| "manaweb.db".into());
    let dir = args.next().unwrap_or_else(|| "scryfall/art".into());
    let rest = args.next();

    let pool = manaweb_artwork::open(&db).await?;
    let mut artworks = artwork::all(&pool).await?;
    tracing::info!(artworks = artworks.len(), "artworks in the cache");

    // The fourth argument is a count to one command and a path to another, so
    // each reads it rather than both reading it as both.
    match command.as_str() {
        "pull" => {
            artworks.truncate(limit(rest.as_deref()));
            pull(&artworks, &dir).await
        }
        "hash" => write(&artworks, &dir, Path::new(rest.as_deref().unwrap_or(STORE))),
        "measure" => {
            artworks.truncate(limit(rest.as_deref()));
            measure(&artworks, &dir)
        }
        "cards" => cards(&pool, &dir, limit(rest.as_deref())).await,
        "artbox" => artbox(&pool, &dir, Path::new(rest.as_deref().unwrap_or(CARDS))).await,
        "photos" => {
            photos(
                &pool,
                &artworks,
                &dir,
                Path::new(rest.as_deref().unwrap_or(STORE)),
            )
            .await
        }
        other => {
            tracing::error!(
                "no such command: {other:?} \
                 (pull, hash, measure, cards, photos, artbox, refusals)"
            );
            Ok(())
        }
    }
}

async fn pull(artworks: &[Artwork], dir: &str) -> Result<()> {
    let mut fetcher = Fetcher::new(dir)?;
    let (mut held, mut pulled, mut failed) = (0usize, 0usize, 0usize);

    for (done, artwork) in artworks.iter().enumerate() {
        if fetcher.holds(artwork) {
            held += 1;
            continue;
        }
        match fetcher.get(artwork).await {
            Ok(_) => pulled += 1,
            // One artwork nobody can scan is not worth ending a run for; the
            // count is what says whether it was one or thousands.
            Err(error) => {
                failed += 1;
                tracing::warn!(artwork = artwork.id, "{error}");
            }
        }
        if done % 1000 == 0 {
            tracing::info!(done, held, pulled, failed, "pulling");
        }
    }

    tracing::info!(held, pulled, failed, "pulled");
    Ok(())
}

/// Where the whole-card images land, which is not where the artwork does.
const CARDS: &str = "scryfall/cards";

/// How many of each shape are measured for an art box. The spread within one
/// is small, so this is about outliers rather than precision.
const MEASURED: u32 = 20;

/// Where the artwork sits on each shape of card, measured rather than taken
/// from a diagram.
///
/// Scryfall's `art_crop` is what the index is keyed by, so finding it inside
/// their own picture of the whole card says what a scanner has to cut out of
/// a photograph. Reads what `pull` and `cards` already fetched.
async fn artbox(pool: &sqlx::SqlitePool, art: &str, cards: &Path) -> Result<()> {
    let wanted = photo::sample(pool, MEASURED).await?;
    let mut found: BTreeMap<String, Vec<Rect>> = BTreeMap::new();
    let (mut read, mut absent) = (0usize, 0usize);

    for (printing, label) in &wanted {
        let id = &printing.art;
        let crop = Path::new(art)
            .join(&id[0..2])
            .join(&id[2..4])
            .join(format!("{id}.jpg"));
        let (Ok(whole), Ok(part)) = (image::open(cards.join(label.name())), image::open(&crop))
        else {
            absent += 1;
            continue;
        };

        let (whole, part) = (Plane::new(&whole), Plane::new(&part));
        let (Some(whole), Some(part)) = (whole.frame(), part.frame()) else {
            absent += 1;
            continue;
        };
        if let Some(rect) = photo::locate(&whole, &part) {
            // By frame as well as shape, because three frame eras share the
            // shape `older` and do not share an art box.
            found
                .entry(format!("{} {}", printing.stratum, printing.frame))
                .or_default()
                .push(rect);
            read += 1;
        }
    }

    tracing::info!(read, absent, "located");
    println!(
        "{:<18} {:>6} {:>13} {:>13} {:>13} {:>13}",
        "shape and frame", "shots", "left", "top", "right", "bottom"
    );
    for (shape, rects) in &found {
        // A median alone hid that one shape was two boxes, so each edge
        // carries how far its own readings reach either side of it.
        let edge = |pick: fn(&Rect) -> f32| {
            let mut held: Vec<f32> = rects.iter().map(pick).collect();
            held.sort_by(f32::total_cmp);
            let mid = held[held.len() / 2];
            format!("{mid:.3}±{:.3}", held[held.len() - 1] - held[0])
        };
        println!(
            "{shape:<18} {:>6} {:>13} {:>13} {:>13} {:>13}",
            rects.len(),
            edge(|r| r.left),
            edge(|r| r.top),
            edge(|r| r.right),
            edge(|r| r.bottom),
        );
    }
    Ok(())
}

/// Every refusal the detector makes over a directory of frames, and what
/// another threshold would have made of the same ones.
///
/// The measurements are kept rather than the verdicts, so every value but the
/// flood's own step is answered off one pass. `MANAWEB_FRAMES` adds a row per
/// frame, which is what names the one that went wrong.
fn refusals(dir: &str, step: u8) -> Result<()> {
    let mut paths: Vec<std::path::PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|held| {
            let path = held.ok()?.path();
            let kind = path.extension()?.to_str()?.to_ascii_lowercase();
            ["jpg", "jpeg", "png"]
                .contains(&kind.as_str())
                .then_some(path)
        })
        .collect();
    paths.sort();

    let detail = std::env::var_os("MANAWEB_FRAMES").is_some();
    let masks = std::env::var_os("MANAWEB_MASKS").map(std::path::PathBuf::from);
    if let Some(into) = &masks {
        std::fs::create_dir_all(into)?;
    }
    let mut reads: Vec<Reading> = Vec::with_capacity(paths.len());
    let mut unreadable = 0usize;

    for path in &paths {
        let Some(image) = photo::read(path) else {
            unreadable += 1;
            tracing::warn!(frame = %path.display(), "will not decode");
            continue;
        };
        let plane = Plane::new(&image);
        let Some(frame) = plane.frame() else {
            unreadable += 1;
            continue;
        };

        let read = detect::reading_at(&frame, step);
        if let Some(into) = &masks {
            mask(
                &frame,
                step,
                &into.join(format!("{stem}.png", stem = stem(path))),
            );
        }
        if detail {
            println!(
                "frame\t{}\t{}\t{:.3}\t{:.3}\t{:.3}\t{:.3}\t{:.3}",
                path.file_name().unwrap_or_default().to_string_lossy(),
                read.refused.map_or("found", Refusal::name),
                read.table,
                read.run,
                read.fill,
                read.ratio,
                read.covering,
            );
        }
        reads.push(read);
    }

    tracing::info!(frames = reads.len(), unreadable, step, "read");
    if reads.is_empty() {
        return Ok(());
    }

    println!();
    let shipped = Tally::of(&reads, |read| read.refused);
    shipped.report("shipped", f32::from(step));
    println!();
    let mut adrift = Vec::new();
    for (name, values) in SWEEPS {
        for &value in values {
            let held = Tally::of(&reads, |read| under(read, name, value));
            held.report(name, value);
            // `under` states the checks and their order a second time, so a
            // sweep at the shipped value is what says the two still agree.
            if shipped_value(name) == Some(value) && held != shipped {
                adrift.push(name);
            }
        }
    }
    if !adrift.is_empty() {
        return Err(Error::Adrift(adrift.join(", ")));
    }
    Ok(())
}

/// What a sweep's own threshold is set to in the detector, for the row that
/// has to come back saying what the shipped one said.
fn shipped_value(name: &str) -> Option<f32> {
    match name {
        "RATIO_SLACK" => Some(detect::RATIO_SLACK),
        "LEAST_TABLE" => Some(detect::LEAST_TABLE),
        "LEAST_FILL" => Some(detect::LEAST_FILL),
        _ => None,
    }
}

/// A file's name without its extension, for naming what is written about it.
fn stem(path: &Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into()
}

/// The grid the checks read, written out: black is the table the flood
/// reached, white whatever it stopped at.
///
/// A refusal names a check; only the outline says what the check was
/// looking at.
fn mask(frame: &Frame, step: u8, out: &Path) {
    let Some((flooded, width, height)) = detect::flooded(frame, step) else {
        return;
    };
    let levels: Vec<u8> = flooded
        .iter()
        .map(|held| if *held { 0u8 } else { 255u8 })
        .collect();
    let (Ok(width), Ok(height)) = (u32::try_from(width), u32::try_from(height)) else {
        return;
    };
    let Some(image) = image::GrayImage::from_raw(width, height, levels) else {
        return;
    };
    if let Err(error) = image.save(out) {
        tracing::warn!(mask = %out.display(), "{error}");
    }
}

/// The threshold values a sweep asks about beside the shipped one.
const SWEEPS: [(&str, &[f32]); 3] = [
    ("RATIO_SLACK", &[0.10, 0.20, 0.35, 0.45]),
    ("LEAST_TABLE", &[0.10, 0.25, 0.35, 0.45]),
    ("LEAST_FILL", &[0.80, 0.86, 0.92, 0.96]),
];

/// The first check a reading fails with one threshold moved.
///
/// A refusal no threshold reaches stands whatever the sweep says, and so does
/// a frame whose corners were never measured.
fn under(read: &Reading, name: &str, value: f32) -> Option<Refusal> {
    if matches!(
        read.refused,
        Some(Refusal::Grid | Refusal::Nothing | Refusal::Corners | Refusal::Flat)
    ) || read.ratio.is_nan()
    {
        return read.refused;
    }

    let at = |held: &str, shipped: f32| if held == name { value } else { shipped };
    if read.table < at("LEAST_TABLE", detect::LEAST_TABLE) {
        Some(Refusal::Table)
    } else if read.fill < at("LEAST_FILL", detect::LEAST_FILL) {
        Some(Refusal::Fill)
    } else if (read.ratio - detect::RATIO).abs() > at("RATIO_SLACK", detect::RATIO_SLACK) {
        Some(Refusal::Shape)
    } else if read.covering < at("LEAST_AREA", detect::LEAST_AREA) {
        Some(Refusal::Area)
    } else {
        None
    }
}

/// Every refusal counted, in the order the detector makes them.
#[derive(Debug, Default, PartialEq, Eq)]
struct Tally {
    found: usize,
    counts: [usize; REASONS.len()],
}

const REASONS: [Refusal; 8] = [
    Refusal::Grid,
    Refusal::Table,
    Refusal::Nothing,
    Refusal::Corners,
    Refusal::Flat,
    Refusal::Fill,
    Refusal::Shape,
    Refusal::Area,
];

impl Tally {
    fn of(reads: &[Reading], why: impl Fn(&Reading) -> Option<Refusal>) -> Self {
        let mut held = Self::default();
        for read in reads {
            match why(read) {
                None => held.found += 1,
                Some(refusal) => {
                    let at = REASONS
                        .iter()
                        .position(|held| *held == refusal)
                        .expect("REASONS holds every refusal");
                    held.counts[at] += 1;
                }
            }
        }
        held
    }

    fn report(&self, name: &str, value: f32) {
        let whole = self.found + self.counts.iter().sum::<usize>();
        // Printed beside the counts rather than under a header, so a run over
        // one corpus reads without the columns being counted out.
        let named: Vec<String> = REASONS
            .iter()
            .zip(&self.counts)
            .filter(|&(_, &count)| count > 0)
            .map(|(why, count)| format!("{}={count}", why.name()))
            .collect();
        println!(
            "{name:<12} {value:>5.2} found {:>4}/{whole:<4} {}",
            self.found,
            named.join(" ")
        );
    }
}

/// Where the store lands unless told otherwise, beside the images it covers.
const STORE: &str = "scryfall/hashes";

/// How many artworks to stop at, everything being the default.
fn limit(arg: Option<&str>) -> usize {
    arg.and_then(|count| count.parse().ok())
        .unwrap_or(usize::MAX)
}

/// Hashes what the pull fetched, into the store the export publishes from.
///
/// Whatever is already there is kept, so a set released since the last run
/// costs its own images rather than all fifty thousand.
fn write(artworks: &[Artwork], dir: &str, out: &Path) -> Result<()> {
    let fetcher = Fetcher::new(dir)?;
    let mut store = match std::fs::read(out) {
        Ok(bytes) => Store::read(&bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Store::new(),
        Err(error) => return Err(error.into()),
    };

    let (mut held, mut hashed, mut absent, mut failed) = (0usize, 0usize, 0usize, 0usize);
    for (done, artwork) in artworks.iter().enumerate() {
        let Some(id) = store::uuid(&artwork.id) else {
            tracing::warn!(artwork = artwork.id, "not an illustration id");
            failed += 1;
            continue;
        };
        if store.get(&id).is_some() {
            held += 1;
        } else if !fetcher.holds(artwork) {
            absent += 1;
        } else {
            // An image that will not decode is one artwork nobody can scan,
            // which is not worth ending a run over.
            match read(&fetcher.path(artwork)) {
                Some(found) => {
                    store.insert(id, found);
                    hashed += 1;
                }
                None => failed += 1,
            }
        }
        if done % 1000 == 0 {
            tracing::info!(done, held, hashed, absent, failed, "hashing");
        }
    }

    // Written whole and moved into place: a run interrupted part way leaves
    // the store it started from rather than a prefix of one.
    let partial = out.with_extension("part");
    std::fs::write(&partial, store.write())?;
    std::fs::rename(&partial, out)?;

    tracing::info!(
        held,
        hashed,
        absent,
        failed,
        artworks = store.len(),
        "hashed"
    );
    Ok(())
}

/// One artwork's entry, or nothing where the file on disk is not an image.
fn read(path: &Path) -> Option<[Hash; HASHES]> {
    let image = image::open(path)
        .inspect_err(|error| tracing::warn!(artwork = %path.display(), "{error}"))
        .ok()?;
    Plane::new(&image)
        .frame()
        .as_ref()
        .map(manaweb_scanner::entry)
}

/// Hashes everything on disk, then asks what a degraded copy retrieves.
///
/// One query is compared against every artwork, because a scan of fifty
/// thousand 64-bit words is microseconds and an approximate structure would
/// be measuring the structure.
fn measure(artworks: &[Artwork], dir: &str) -> Result<()> {
    let fetcher = Fetcher::new(dir)?;
    let mut held = Vec::new();
    let mut index: Vec<Vec<Vec<Hash>>> = vec![Vec::new(); KINDS.len()];

    for artwork in artworks {
        if !fetcher.holds(artwork) {
            continue;
        }
        let Ok(image) = image::open(fetcher.path(artwork)) else {
            continue;
        };
        let plane = Plane::new(&image);
        let Some(frame) = plane.frame() else {
            continue;
        };
        for (kind, entry) in KINDS.iter().zip(index.iter_mut()) {
            entry.push(kind.entry(&frame));
        }
        held.push(artwork.clone());
    }

    tracing::info!(indexed = held.len(), "hashed");
    if held.len() < 2 {
        tracing::warn!("nothing to measure yet; pull first");
        return Ok(());
    }

    // Spread across the whole set rather than the first few hundred, which
    // are one corner of an id space that sorts by nothing meaningful.
    let step = (held.len() / QUERIES).max(1);
    let queries: Vec<usize> = (0..held.len()).step_by(step).collect();

    println!(
        "{:<8} {:>12} {:>8} {:>8} {:>9} {:>7} {:>7}",
        "query", "index", "recall@1", "recall@5", "recall@10", "d(true)", "margin"
    );

    for degradation in degrade::ALL {
        let mut scores: Vec<Scores> = KINDS.iter().map(|_| Scores::default()).collect();

        for &at in &queries {
            let Ok(image) = image::open(fetcher.path(&held[at])) else {
                continue;
            };
            let plane = Plane::new(&(degradation.apply)(&image));
            let Some(query) = plane.frame() else {
                continue;
            };

            for ((kind, entry), score) in KINDS.iter().zip(&index).zip(&mut scores) {
                score.record(entry, &kind.query(&query), at);
            }
        }

        for (kind, score) in KINDS.iter().zip(&scores) {
            score.report(degradation.name, kind.name);
        }
    }

    Ok(())
}

/// How many artworks are asked about. Enough to separate a 99% from a 90%,
/// and few enough that a run is minutes.
const QUERIES: usize = 500;

/// One way of holding an artwork, and the hash a query is turned into.
struct Kind {
    name: &'static str,
    hash: fn(&Frame) -> Hash,
    /// Whether the index holds the artwork at several crops or just the one.
    insets: bool,
    /// And whether the query is asked at several, which costs the querier
    /// nothing the index has not already paid for.
    asks: bool,
}

impl Kind {
    fn entry(&self, frame: &Frame) -> Vec<Hash> {
        self.crops(frame, self.insets)
    }

    fn query(&self, frame: &Frame) -> Vec<Hash> {
        self.crops(frame, self.asks)
    }

    fn crops(&self, frame: &Frame, several: bool) -> Vec<Hash> {
        if !several {
            return vec![(self.hash)(frame)];
        }
        hash::INSETS
            .iter()
            .map(|&inset| (self.hash)(&frame.inset(inset)))
            .collect()
    }
}

const KINDS: [Kind; 5] = [
    Kind {
        name: "dhash",
        hash: hash::dhash,
        insets: false,
        asks: false,
    },
    Kind {
        name: "phash",
        hash: hash::phash,
        insets: false,
        asks: false,
    },
    Kind {
        name: "dhash+crops",
        hash: hash::dhash,
        insets: true,
        asks: false,
    },
    Kind {
        name: "phash+crops",
        hash: hash::phash,
        insets: true,
        asks: false,
    },
    Kind {
        name: "phash+asked",
        hash: hash::phash,
        insets: true,
        asks: true,
    },
];

/// What one index scored over every query of one degradation.
#[derive(Debug, Default)]
struct Scores {
    asked: usize,
    at: [usize; 3],
    /// Distance to the artwork the query actually came from.
    trues: Vec<u32>,
    /// How much further away the nearest other artwork was. Negative means it
    /// was nearer, which is the retrieval going wrong.
    margins: Vec<i64>,
}

/// The ranks `at` counts, in order.
const RANKS: [usize; 3] = [1, 5, 10];

/// The nearest any hash the index holds comes to any the query was asked at.
fn nearest(entry: &[Hash], want: &[Hash]) -> u32 {
    entry
        .iter()
        .flat_map(|&held| want.iter().map(move |&want| hash::distance(want, held)))
        .min()
        .unwrap_or(u32::MAX)
}

impl Scores {
    fn record(&mut self, index: &[Vec<Hash>], want: &[Hash], at: usize) {
        let truth = nearest(&index[at], want);
        let mut rank = 0;
        let mut other = u32::MAX;

        for (which, entry) in index.iter().enumerate() {
            if which == at {
                continue;
            }
            let distance = nearest(entry, want);
            if distance < truth {
                rank += 1;
            }
            other = other.min(distance);
        }

        self.asked += 1;
        for (count, &rank_at) in self.at.iter_mut().zip(&RANKS) {
            if rank < rank_at {
                *count += 1;
            }
        }
        self.trues.push(truth);
        self.margins.push(i64::from(other) - i64::from(truth));
    }

    fn report(&self, degradation: &str, index: &str) {
        if self.asked == 0 {
            return;
        }
        let share = |count: usize| {
            let count = u32::try_from(count).unwrap_or(u32::MAX);
            let asked = u32::try_from(self.asked).unwrap_or(1);
            f64::from(count) * 100.0 / f64::from(asked)
        };
        println!(
            "{degradation:<8} {index:>12} {:>7.1}% {:>7.1}% {:>8.1}% {:>7} {:>7}",
            share(self.at[0]),
            share(self.at[1]),
            share(self.at[2]),
            median(&self.trues),
            median(&self.margins),
        );
    }
}

fn median<T: Copy + Ord + std::fmt::Display>(values: &[T]) -> String {
    if values.is_empty() {
        return "-".to_owned();
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    sorted[sorted.len() / 2].to_string()
}

/// How many of each stratum `cards` pulls when not told otherwise. Enough to
/// tell a 90% from a 99% once the four are put together.
const EACH: usize = 60;

/// Pulls whole-card images to photograph, named as a photograph has to be.
///
/// Scoring these is the ceiling a photograph is measured against, and the
/// one way to ask what the art box costs without a camera.
async fn cards(pool: &sqlx::SqlitePool, dir: &str, each: usize) -> Result<()> {
    let each = u32::try_from(each.min(EACH)).unwrap_or(u32::MAX);
    let wanted = photo::sample(pool, each).await?;
    tracing::info!(cards = wanted.len(), "sampled");

    let mut fetcher = Fetcher::new(dir)?;
    let (mut held, mut pulled, mut failed) = (0usize, 0usize, 0usize);

    for (printing, label) in &wanted {
        let path = Path::new(dir).join(label.name());
        if path.exists() {
            held += 1;
            continue;
        }
        match fetcher.fetch(&photo::card_image(&printing.id), &path).await {
            Ok(_) => pulled += 1,
            Err(error) => {
                failed += 1;
                tracing::warn!(card = printing.id, "{error}");
            }
        }
    }

    tracing::info!(held, pulled, failed, "pulled");
    Ok(())
}

/// Scores every photograph in `dir` against the store, by printing.
///
/// The index is the store as published, so this asks what a client would
/// retrieve rather than what a rebuild of the hashing would.
async fn photos(
    pool: &sqlx::SqlitePool,
    artworks: &[Artwork],
    dir: &str,
    out: &Path,
) -> Result<()> {
    let store = Store::read(&std::fs::read(out)?)?;
    let index: Vec<(&str, [Hash; HASHES])> = artworks
        .iter()
        .filter_map(|artwork| {
            let id = store::uuid(&artwork.id)?;
            Some((artwork.id.as_str(), store.get(&id)?))
        })
        .collect();
    tracing::info!(indexed = index.len(), store = %out.display(), "index read");

    let mut shots: Vec<(photo::Label, std::path::PathBuf)> = std::fs::read_dir(dir)?
        .filter_map(|held| {
            let path = held.ok()?.path();
            let label = photo::Label::read(path.file_name()?.to_str()?)?;
            Some((label, path))
        })
        .collect();
    shots.sort_by(|a, b| a.1.cmp(&b.1));

    if shots.is_empty() {
        tracing::warn!(%dir, "nothing named <set>-<number>-<lang>__<how> to score");
        return Ok(());
    }

    let mut conditions: BTreeMap<String, photo::Tally> = BTreeMap::new();
    let mut strata: BTreeMap<String, photo::Tally> = BTreeMap::new();
    let mut misses: Vec<photo::Miss> = Vec::new();
    let (mut unknown, mut unreadable) = (0usize, 0usize);

    for (label, path) in &shots {
        let Some(printing) = photo::find(pool, label).await? else {
            unknown += 1;
            tracing::warn!(shot = %path.display(), "no such printing in the cache");
            continue;
        };
        let Some(hit) = score(pool, &index, path, &printing).await? else {
            unreadable += 1;
            continue;
        };

        // Each piece of the condition on its own, a shot under two of them
        // counting for both: fifty names one to a shot say nothing.
        for tag in std::iter::once("(all)").chain(label.tags()) {
            conditions.entry(tag.to_owned()).or_default().record(&hit);
        }
        strata
            .entry(printing.stratum.clone())
            .or_default()
            .record(&hit);

        if std::env::var_os("MANAWEB_SHOTS").is_some() {
            println!(
                "shot\t{}\t{}\t{}\t{}\t{}\t{}",
                label.name(),
                printing.stratum,
                u8::from(hit.printing),
                hit.found,
                hit.margin,
                hit.candidates,
            );
        }
        if !hit.printing {
            misses.push(photo::Miss {
                shot: label.name(),
                stratum: printing.stratum.clone(),
                art: hit.art,
                found: hit.found,
                truth: hit.truth,
            });
        }
    }

    tracing::info!(shots = shots.len(), unknown, unreadable, "scored");

    photo::Tally::header("varied");
    for (name, tally) in &conditions {
        tally.report(name);
    }
    println!();
    photo::Tally::header("frame");
    for (name, tally) in &strata {
        tally.report(name);
    }

    // Named rather than counted: a rate says how often, and only the list
    // says whether they have anything in common.
    if !misses.is_empty() {
        println!();
        misses.sort_by_key(|miss| (miss.stratum.clone(), miss.shot.clone()));
        photo::Miss::header();
        for miss in &misses {
            miss.report();
        }
    }

    Ok(())
}

/// One photograph against the index, or nothing where it will not decode.
async fn score(
    pool: &sqlx::SqlitePool,
    index: &[(&str, [Hash; HASHES])],
    path: &Path,
    printing: &photo::Printing,
) -> Result<Option<photo::Hit>> {
    let Some(image) = photo::read(path) else {
        tracing::warn!(shot = %path.display(), "will not decode");
        return Ok(None);
    };
    let plane = Plane::new(&image);
    let Some(frame) = plane.frame() else {
        tracing::warn!(shot = %path.display(), "no pixels in it");
        return Ok(None);
    };
    let asked = query::query(&frame);
    let want = asked.hashes;
    if want.is_empty() {
        tracing::warn!(shot = %path.display(), "no art box in it");
        return Ok(None);
    }

    let arts = printing.arts();
    let (mut best, mut found, mut next, mut truth) = (None, u32::MAX, u32::MAX, u32::MAX);
    for (id, entry) in index {
        // The whole query against one entry, so the runner-up is another
        // artwork rather than this one read at a second crop.
        let distance = nearest(entry, &want);
        if arts.contains(id) {
            truth = truth.min(distance);
        }
        if distance < found {
            next = found;
            found = distance;
            best = Some(*id);
        } else if distance < next {
            next = distance;
        }
    }

    let Some(best) = best else {
        return Ok(None);
    };

    let candidates = photo::carrying(pool, best).await?;
    Ok(Some(photo::Hit {
        printing: candidates.contains(&printing.id),
        candidates: candidates.len(),
        found,
        margin: i64::from(next) - i64::from(found),
        art: best.to_owned(),
        truth,
        detected: asked.found.is_some(),
    }))
}
