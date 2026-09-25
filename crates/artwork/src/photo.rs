//! Scoring a photograph of a card against the index.
//!
//! What this answers that `measure` cannot is which *printing* a photograph
//! names, an artwork being shared by every printing that carries it — see
//! `docs/roadmap.md`.

use std::path::Path;

use image::{DynamicImage, ImageDecoder as _, ImageReader};
use manaweb_scanner::Frame;
use sqlx::SqlitePool;

use crate::Result;

/// A photograph, turned the way the camera was held.
///
/// A phone writes the sensor's own rows and a tag saying which way up they
/// go, and nothing below here reads tags, so a portrait shot arrives on its
/// side unless this is applied.
#[must_use]
pub fn read(path: &Path) -> Option<DynamicImage> {
    // Guessed rather than taken from the extension: an export that renamed a
    // file it did not re-encode would otherwise decode as nothing.
    let reader = ImageReader::open(path).ok()?.with_guessed_format().ok()?;
    let mut decoder = reader.into_decoder().ok()?;
    let turned = decoder.orientation().ok()?;
    let mut image = DynamicImage::from_decoder(decoder).ok()?;
    image.apply_orientation(turned);
    Some(image)
}

/// What a filename says a photograph is of: `<set>-<number>[-<lang>]__<how>`.
///
/// A collector number carries hyphens of its own, so the set is read off the
/// front and the language off the back, leaving whatever is between.
#[derive(Debug, Clone)]
pub struct Label {
    pub set: String,
    pub number: String,
    pub lang: String,
    /// What was varied for this shot, which is what the report groups by.
    pub condition: String,
}

/// What a printing can be printed in, so the last piece of a name can be told
/// from the end of a collector number. Scryfall's own set, and no collector
/// number in the cache reads as one of them.
const LANGS: [&str; 19] = [
    "ar", "de", "dw", "en", "es", "fr", "grc", "he", "it", "ja", "ko", "la", "ph", "pt", "qya",
    "ru", "sa", "zhs", "zht",
];

/// The one a printing is in unless the name says otherwise.
const ENGLISH: &str = "en";

impl Label {
    #[must_use]
    pub fn read(name: &str) -> Option<Self> {
        let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
        let (named, condition) = stem.rsplit_once("__")?;
        let (set, rest) = named.split_once('-')?;
        let (number, lang) = match rest.rsplit_once('-') {
            Some((number, lang)) if LANGS.contains(&lang) => (number, lang),
            _ => (rest, ENGLISH),
        };
        (!set.is_empty() && !number.is_empty()).then(|| Self {
            set: set.to_owned(),
            number: number.to_owned(),
            lang: lang.to_owned(),
            condition: condition.to_owned(),
        })
    }

    /// What was varied, one piece at a time, so the report can cut by each.
    pub fn tags(&self) -> impl Iterator<Item = &str> {
        self.condition.split('-')
    }

    /// How a shot of this printing is named, which is what `cards` writes and
    /// what a photograph has to be called to be scored.
    #[must_use]
    pub fn name(&self) -> String {
        let Self {
            set,
            number,
            lang,
            condition,
        } = self;
        let lang = if lang == ENGLISH {
            String::new()
        } else {
            format!("-{lang}")
        };
        format!("{set}-{number}{lang}__{condition}.jpg")
    }
}

/// One printing as the scoring needs it.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Printing {
    pub id: String,
    /// The illustration on the front, and on the back where there is one.
    pub art: String,
    pub back_art: Option<String>,
    /// Which shape of card this is, for the report's second cut. What each
    /// of them costs is `docs/roadmap.md`.
    pub stratum: String,
}

impl Printing {
    /// Every artwork that resolves to this printing, either side.
    #[must_use]
    pub fn arts(&self) -> Vec<&str> {
        let mut out = vec![self.art.as_str()];
        out.extend(self.back_art.as_deref().filter(|back| *back != self.art));
        out
    }
}

/// The printing a label names, or nothing where the cache has no such row.
///
/// # Errors
///
/// Fails on a database error.
pub async fn find(pool: &SqlitePool, label: &Label) -> Result<Option<Printing>> {
    Ok(sqlx::query_as(
        "SELECT c.id,
                c.illustration_id AS art,
                json_extract(c.card_faces, '$[1].illustration_id') AS back_art,
                CASE WHEN c.layout IN ('token', 'double_faced_token', 'emblem', 'art_series')
                          THEN 'token'
                     WHEN c.layout IN ('split', 'flip', 'planar', 'scheme')
                          OR o.type_line LIKE 'Battle%' THEN 'sideways'
                     WHEN o.type_line LIKE '%Planeswalker%' THEN 'walker'
                     WHEN c.full_art THEN 'full-art'
                     WHEN c.border_color = 'borderless' THEN 'borderless'
                     WHEN c.frame = '2015' THEN 'modern'
                     ELSE 'older' END AS stratum
         FROM cards c JOIN oracle o ON o.id = c.oracle_id
         WHERE c.set_code = ? AND c.collector_number = ? AND c.lang = ?
           AND c.illustration_id IS NOT NULL",
    )
    .bind(&label.set)
    .bind(&label.number)
    .bind(&label.lang)
    .fetch_optional(pool)
    .await?)
}

/// Every printing an artwork retrieves, the set a set code then picks from.
///
/// # Errors
///
/// Fails on a database error.
pub async fn carrying(pool: &SqlitePool, art: &str) -> Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM cards
         WHERE NOT digital
           AND (illustration_id = ?
                OR json_extract(card_faces, '$[1].illustration_id') = ?)",
    )
    .bind(art)
    .bind(art)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// A spread of printings to photograph, the same number from each stratum.
///
/// Deterministic, and an id sorts by nothing meaningful, so the same call
/// twice names the same cards.
///
/// # Errors
///
/// Fails on a database error.
pub async fn sample(pool: &SqlitePool, each: u32) -> Result<Vec<(Printing, Label)>> {
    let rows: Vec<Row> = sqlx::query_as(
        "WITH held AS (
             SELECT c.id, c.set_code, c.collector_number, c.lang,
                    c.illustration_id AS art,
                    json_extract(c.card_faces, '$[1].illustration_id') AS back_art,
                    CASE WHEN c.layout IN ('token', 'double_faced_token', 'emblem', 'art_series')
                          THEN 'token'
                     WHEN c.layout IN ('split', 'flip', 'planar', 'scheme')
                          OR o.type_line LIKE 'Battle%' THEN 'sideways'
                     WHEN o.type_line LIKE '%Planeswalker%' THEN 'walker'
                     WHEN c.full_art THEN 'full-art'
                     WHEN c.border_color = 'borderless' THEN 'borderless'
                     WHEN c.frame = '2015' THEN 'modern'
                     ELSE 'older' END AS stratum,
                    row_number() OVER (
                        PARTITION BY CASE WHEN c.layout IN ('token', 'double_faced_token', 'emblem', 'art_series')
                          THEN 'token'
                     WHEN c.layout IN ('split', 'flip', 'planar', 'scheme')
                          OR o.type_line LIKE 'Battle%' THEN 'sideways'
                     WHEN o.type_line LIKE '%Planeswalker%' THEN 'walker'
                     WHEN c.full_art THEN 'full-art'
                     WHEN c.border_color = 'borderless' THEN 'borderless'
                     WHEN c.frame = '2015' THEN 'modern'
                     ELSE 'older' END
                        ORDER BY c.id
                    ) AS rank
             FROM cards c JOIN oracle o ON o.id = c.oracle_id
             WHERE NOT c.digital AND c.lang = 'en'
               AND c.illustration_id IS NOT NULL
               AND c.image_status IN ('highres_scan', 'lowres')
         )
         SELECT id, set_code, collector_number, lang, art, back_art, stratum
         FROM held WHERE rank <= ? ORDER BY stratum, rank",
    )
    .bind(each)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, set, number, lang, art, back_art, stratum)| {
            let label = Label {
                set,
                number,
                lang,
                // Their own image of the card, not a photograph of one.
                condition: "scryfall".to_owned(),
            };
            let printing = Printing {
                id,
                art,
                back_art,
                stratum,
            };
            (printing, label)
        })
        .collect())
}

/// One row of the sample, the shape the query hands back.
type Row = (
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    String,
);

/// Where Scryfall serves the whole card, frame and all.
#[must_use]
pub fn card_image(print: &str) -> String {
    let (a, b) = (&print[0..1], &print[1..2]);
    format!("https://cards.scryfall.io/normal/front/{a}/{b}/{print}.jpg")
}

/// A rectangle of something, as fractions of its width and height.
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

/// Where the artwork sits on a modern card.
///
/// Measured rather than taken from a diagram, by `just artbox`.
pub const ART: Rect = Rect {
    left: 0.082,
    top: 0.118,
    right: 0.920,
    bottom: 0.556,
};

/// How much of a photograph's height the card is taken to fill, for when
/// nothing is detected and a phone will not focus on a card against its lens.
///
/// Every one is tried and the nearest kept. What the floor costs, and why it
/// is not asked of the person holding the camera, is `docs/roadmap.md`.
pub const FILLS: [f32; 5] = [1.0, 0.85, 0.72, 0.6, 0.5];

impl Rect {
    /// The middle of a frame, `fill` of it tall and a card's own shape.
    ///
    /// Its shape and not the frame's: a phone shoots four by three and a card
    /// is 63 by 88, so insetting both axes alike leaves the art box stretched
    /// by the difference.
    // The card's proportions against the frame's are a ratio of two pixel
    // counts, so the casts are that crossing.
    #[allow(clippy::cast_precision_loss)]
    #[must_use]
    pub fn filling(frame: &Frame, fill: f32) -> Self {
        let (across, down) = (frame.width() as f32, frame.height() as f32);
        let tall = (fill.clamp(0.1, 1.0) * down).min(across / manaweb_scanner::detect::RATIO);
        let (half_wide, half_tall) = (
            tall * manaweb_scanner::detect::RATIO / across / 2.0,
            tall / down / 2.0,
        );
        Self {
            left: 0.5 - half_wide,
            top: 0.5 - half_tall,
            right: 0.5 + half_wide,
            bottom: 0.5 + half_tall,
        }
    }

    /// This rectangle of a frame the card fills, or `None` where it lands
    /// outside one.
    // A fraction of a pixel grid is a crossing between a real number and a
    // coordinate, so every cast here is one of those.
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss
    )]
    #[must_use]
    pub fn of<'a>(&self, frame: &Frame<'a>) -> Option<Frame<'a>> {
        let across = |at: f32, of: usize| (at.clamp(0.0, 1.0) * of as f32) as usize;
        let (x, y) = (
            across(self.left, frame.width()),
            across(self.top, frame.height()),
        );
        let right = across(self.right, frame.width());
        let bottom = across(self.bottom, frame.height());
        frame.window(x, y, right.saturating_sub(x), bottom.saturating_sub(y))
    }
}

/// Side of the grid two pictures are compared over when one is being located
/// in the other. Small, because this asks where a crop sits and not what is
/// in it.
const PATCH: usize = 16;

/// A frame's running totals, so the mean of any rectangle is four lookups
/// rather than its area.
struct Totals {
    sums: Vec<f64>,
    width: usize,
    height: usize,
}

// Every number here crosses between a pixel count and the real arithmetic a
// mean and a fraction are worked out in.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
impl Totals {
    fn of(frame: &Frame) -> Self {
        let (width, height) = (frame.width(), frame.height());
        let mut sums = vec![0f64; (width + 1) * (height + 1)];
        for y in 0..height {
            let mut row = 0f64;
            for x in 0..width {
                row += f64::from(frame.at(x, y).unwrap_or(0));
                sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
            }
        }
        Self {
            sums,
            width,
            height,
        }
    }

    fn mean(&self, x0: usize, y0: usize, x1: usize, y1: usize) -> f32 {
        let (x1, y1) = (x1.min(self.width), y1.min(self.height));
        if x1 <= x0 || y1 <= y0 {
            return 0.0;
        }
        let at = |x: usize, y: usize| self.sums[y * (self.width + 1) + x];
        let whole = at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0);
        (whole / ((x1 - x0) * (y1 - y0)) as f64) as f32
    }

    /// One rectangle as a [`PATCH`] grid of means, centered on zero and
    /// scaled, so two exposures of one thing compare alike.
    fn patch(&self, x: usize, y: usize, width: usize, height: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(PATCH * PATCH);
        for down in 0..PATCH {
            for across in 0..PATCH {
                out.push(self.mean(
                    x + across * width / PATCH,
                    y + down * height / PATCH,
                    x + (across + 1) * width / PATCH,
                    y + (down + 1) * height / PATCH,
                ));
            }
        }
        let mean = out.iter().sum::<f32>() / out.len() as f32;
        let spread = (out.iter().map(|held| (held - mean).powi(2)).sum::<f32>() / out.len() as f32)
            .sqrt()
            .max(1.0);
        for held in &mut out {
            *held = (*held - mean) / spread;
        }
        out
    }
}

/// How much of a card's width the artwork is searched for at, and in what
/// steps. Scryfall's own crops run from a third of one to nearly all of it.
const SCALES: (f32, f32, f32) = (0.30, 1.0, 0.02);

/// Where `art` sits inside `card`, searched over position and scale.
///
/// The crop's own proportions fix the height once a width is chosen, so what
/// is left is two offsets and one scale.
// Same crossing as [`Totals`].
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
#[must_use]
pub fn locate(card: &Frame, art: &Frame) -> Option<Rect> {
    let wanted = Totals::of(art).patch(0, 0, art.width(), art.height());
    let tall = art.height() as f32 / art.width() as f32;
    let totals = Totals::of(card);
    let (wide, high) = (card.width(), card.height());

    let (mut scale, mut best) = (SCALES.0, None::<(f32, Rect)>);
    while scale <= SCALES.1 {
        let width = (wide as f32 * scale) as usize;
        let height = (width as f32 * tall) as usize;
        scale += SCALES.2;
        if width < PATCH || height < PATCH || height > high {
            continue;
        }

        let (across, down) = ((wide / 48).max(1), (high / 64).max(1));
        for y in (0..=(high - height)).step_by(down) {
            for x in (0..=(wide - width)).step_by(across) {
                let held = totals.patch(x, y, width, height);
                let cost: f32 = held.iter().zip(&wanted).map(|(a, b)| (a - b).powi(2)).sum();
                if best.as_ref().is_none_or(|(low, _)| cost < *low) {
                    best = Some((
                        cost,
                        Rect {
                            left: x as f32 / wide as f32,
                            top: y as f32 / high as f32,
                            right: (x + width) as f32 / wide as f32,
                            bottom: (y + height) as f32 / high as f32,
                        },
                    ));
                }
            }
        }
    }
    best.map(|(_, rect)| rect)
}

/// What one condition scored over every photograph taken under it.
#[derive(Debug, Default)]
pub struct Tally {
    shots: usize,
    /// The photograph's own printing came back.
    printings: usize,
    /// An artwork the photograph's printing carries came back, which is the
    /// number `measure` reports and the weaker of the two.
    artworks: usize,
    /// How many printings the artwork that came back narrows to, which is
    /// what a set code and a collector number are left to pick between.
    candidates: Vec<usize>,
    /// Distance to the artwork retrieved, and how much further the next one
    /// was. A near miss and a confident wrong answer read the same in a
    /// recall figure and differently here.
    found: Vec<u32>,
    margins: Vec<i64>,
    /// Shots a card was found in, and shots where the crop that found it
    /// beat every guess at where one was.
    detected: usize,
    won: usize,
}

impl Tally {
    pub fn record(&mut self, hit: &Hit) {
        self.shots += 1;
        self.printings += usize::from(hit.printing);
        self.artworks += usize::from(hit.artwork);
        self.candidates.push(hit.candidates);
        self.found.push(hit.found);
        self.margins.push(hit.margin);
        self.detected += usize::from(hit.framing != Framing::Missed);
        self.won += usize::from(hit.framing == Framing::Read);
    }

    /// The header the rows below line up under.
    pub fn header(of: &str) {
        println!(
            "{of:<16} {:>6} {:>11} {:>10} {:>11} {:>8} {:>7} {:>9} {:>6}",
            "shots",
            "printing@1",
            "artwork@1",
            "candidates",
            "d(found)",
            "margin",
            "detected",
            "won"
        );
    }

    pub fn report(&self, of: &str) {
        if self.shots == 0 {
            return;
        }
        let share = |count: usize| {
            let count = u32::try_from(count).unwrap_or(u32::MAX);
            let shots = u32::try_from(self.shots).unwrap_or(1);
            f64::from(count) * 100.0 / f64::from(shots)
        };
        println!(
            "{of:<16} {:>6} {:>10.1}% {:>9.1}% {:>11} {:>8} {:>7} {:>8.1}% {:>5.1}%",
            self.shots,
            share(self.printings),
            share(self.artworks),
            median(&self.candidates),
            median(&self.found),
            median(&self.margins),
            share(self.detected),
            share(self.won),
        );
    }
}

/// What one photograph scored.
#[derive(Debug)]
pub struct Hit {
    pub printing: bool,
    pub artwork: bool,
    pub candidates: usize,
    /// Distance to the artwork that came back.
    pub found: u32,
    /// And how much further away the next one was.
    pub margin: i64,
    /// The artwork that came back, for a miss to be able to name it.
    pub art: String,
    /// Distance to the artwork the photograph is actually of, which says
    /// whether a miss was a near thing or the art box landing nowhere near.
    pub truth: u32,
    pub framing: Framing,
}

/// Where the art box was taken from, for the answer that came back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    /// Nothing in the frame was shaped like a card.
    Missed,
    /// One was, and a guess at where a card sits still answered nearer.
    Guessed,
    /// One was, and reading it back off its own corners is what answered.
    Read,
}

/// One photograph that did not name its own printing.
#[derive(Debug)]
pub struct Miss {
    pub shot: String,
    pub stratum: String,
    pub art: String,
    pub found: u32,
    pub truth: u32,
}

impl Miss {
    pub fn header() {
        println!(
            "{:<28} {:<12} {:>8} {:>8}  came back instead",
            "shot", "frame", "d(found)", "d(true)"
        );
    }

    pub fn report(&self) {
        let Self {
            shot,
            stratum,
            art,
            found,
            truth,
        } = self;
        println!("{shot:<28} {stratum:<12} {found:>8} {truth:>8}  {art}");
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
