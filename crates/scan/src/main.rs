//! Builds and measures the scanner index.
//!
//! Two jobs, because the pull is hours and the measurement is minutes: `pull`
//! fills a directory with artwork images, `measure` reports what a hash
//! retrieves from it.

use std::process::ExitCode;

use manaweb_scan::fetch::Fetcher;
use manaweb_scan::{Result, artwork, degrade, hash};

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "manaweb_scan=info".into()),
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
    let db = args.next().unwrap_or_else(|| "manaweb.db".into());
    let dir = args.next().unwrap_or_else(|| "local/art".into());
    let limit: usize = args
        .next()
        .and_then(|limit| limit.parse().ok())
        .unwrap_or(usize::MAX);

    let pool = manaweb_scan::open(&db).await?;
    let mut artworks = artwork::all(&pool).await?;
    tracing::info!(artworks = artworks.len(), "artworks in the cache");
    artworks.truncate(limit);

    match command.as_str() {
        "pull" => pull(&artworks, &dir).await,
        "measure" => measure(&artworks, &dir),
        other => {
            tracing::error!("no such command: {other:?} (pull, measure)");
            Ok(())
        }
    }
}

async fn pull(artworks: &[manaweb_scan::Artwork], dir: &str) -> Result<()> {
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

/// Hashes everything on disk, then asks what a degraded copy retrieves.
///
/// One query is compared against every artwork, because a scan of fifty
/// thousand 64-bit words is microseconds and an approximate structure would
/// be measuring the structure.
fn measure(artworks: &[manaweb_scan::Artwork], dir: &str) -> Result<()> {
    let fetcher = Fetcher::new(dir)?;
    let mut held = Vec::new();
    let mut index: Vec<Vec<Vec<hash::Hash>>> = vec![Vec::new(); KINDS.len()];

    for artwork in artworks {
        if !fetcher.holds(artwork) {
            continue;
        }
        let Ok(image) = image::open(fetcher.path(artwork)) else {
            continue;
        };
        for (kind, entry) in KINDS.iter().zip(index.iter_mut()) {
            entry.push(kind.entry(&image));
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
            let query = (degradation.apply)(&image);

            for ((kind, entry), score) in KINDS.iter().zip(&index).zip(&mut scores) {
                score.record(entry, (kind.hash)(&query), at);
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

/// A framing error is the one thing a hash does not survive, so an artwork is
/// also held at the insets a scanner is likeliest to be off by.
const INSETS: [f32; 4] = [0.0, 0.03, 0.06, 0.09];

/// One way of holding an artwork, and the hash a query is turned into.
struct Kind {
    name: &'static str,
    hash: fn(&image::DynamicImage) -> hash::Hash,
    /// Whether the index holds the artwork at several crops or just the one.
    insets: bool,
}

impl Kind {
    fn entry(&self, image: &image::DynamicImage) -> Vec<hash::Hash> {
        if !self.insets {
            return vec![(self.hash)(image)];
        }
        INSETS
            .iter()
            .map(|&inset| (self.hash)(&degrade::inset(image, inset)))
            .collect()
    }
}

const KINDS: [Kind; 4] = [
    Kind {
        name: "dhash",
        hash: hash::dhash,
        insets: false,
    },
    Kind {
        name: "phash",
        hash: hash::phash,
        insets: false,
    },
    Kind {
        name: "dhash+crops",
        hash: hash::dhash,
        insets: true,
    },
    Kind {
        name: "phash+crops",
        hash: hash::phash,
        insets: true,
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

fn nearest(entry: &[hash::Hash], want: hash::Hash) -> u32 {
    entry
        .iter()
        .map(|&held| hash::distance(want, held))
        .min()
        .unwrap_or(u32::MAX)
}

impl Scores {
    fn record(&mut self, index: &[Vec<hash::Hash>], want: hash::Hash, at: usize) {
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
