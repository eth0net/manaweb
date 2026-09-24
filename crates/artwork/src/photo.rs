//! Scoring a photograph of a card against the index.
//!
//! What this answers that `measure` cannot is which *printing* a photograph
//! names, an artwork being shared by every printing that carries it — see
//! `docs/roadmap.md`.

use manaweb_scanner::Frame;
use sqlx::SqlitePool;

use crate::Result;

/// What a filename says a photograph is of: `<set>-<number>-<lang>__<how>`.
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

impl Label {
    #[must_use]
    pub fn read(name: &str) -> Option<Self> {
        let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
        let (named, condition) = stem.rsplit_once("__")?;
        let (named, lang) = named.rsplit_once('-')?;
        let (set, number) = named.split_once('-')?;
        (!set.is_empty() && !number.is_empty() && !lang.is_empty()).then(|| Self {
            set: set.to_owned(),
            number: number.to_owned(),
            lang: lang.to_owned(),
            condition: condition.to_owned(),
        })
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
        format!("{set}-{number}-{lang}__{condition}.jpg")
    }
}

/// One printing as the scoring needs it.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Printing {
    pub id: String,
    /// The illustration on the front, and on the back where there is one.
    pub art: String,
    pub back_art: Option<String>,
    /// Which of the frame's awkward shapes this is, for the report's second
    /// cut: the art box is one rectangle and these are not.
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
        "SELECT id,
                illustration_id AS art,
                json_extract(card_faces, '$[1].illustration_id') AS back_art,
                CASE WHEN full_art THEN 'full-art'
                     WHEN border_color = 'borderless' THEN 'borderless'
                     WHEN frame = '2015' THEN 'modern'
                     ELSE 'older' END AS stratum
         FROM cards
         WHERE set_code = ? AND collector_number = ? AND lang = ?
           AND illustration_id IS NOT NULL",
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
             SELECT id, set_code, collector_number, lang,
                    illustration_id AS art,
                    json_extract(card_faces, '$[1].illustration_id') AS back_art,
                    CASE WHEN full_art THEN 'full-art'
                     WHEN border_color = 'borderless' THEN 'borderless'
                     WHEN frame = '2015' THEN 'modern'
                     ELSE 'older' END AS stratum,
                    row_number() OVER (
                        PARTITION BY CASE WHEN full_art THEN 'full-art'
                     WHEN border_color = 'borderless' THEN 'borderless'
                     WHEN frame = '2015' THEN 'modern'
                     ELSE 'older' END
                        ORDER BY id
                    ) AS rank
             FROM cards
             WHERE NOT digital AND lang = 'en'
               AND illustration_id IS NOT NULL
               AND image_status IN ('highres_scan', 'lowres')
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
                // Scryfall's own image: the capture nothing is wrong with.
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
/// Measured rather than taken from a diagram: Scryfall's own `art_crop` of a
/// 2015-frame printing is 626x457 of a 745x1040 card, at 59,119. Every other
/// frame puts it somewhere else, which is what the strata are there to show.
pub const ART: Rect = Rect {
    left: 0.079,
    top: 0.114,
    right: 0.920,
    bottom: 0.554,
};

impl Rect {
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
}

impl Tally {
    pub fn record(&mut self, hit: &Hit) {
        self.shots += 1;
        self.printings += usize::from(hit.printing);
        self.artworks += usize::from(hit.artwork);
        self.candidates.push(hit.candidates);
        self.found.push(hit.found);
        self.margins.push(hit.margin);
    }

    /// The header the rows below line up under.
    pub fn header(of: &str) {
        println!(
            "{of:<16} {:>6} {:>11} {:>10} {:>11} {:>8} {:>7}",
            "shots", "printing@1", "artwork@1", "candidates", "d(found)", "margin"
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
            "{of:<16} {:>6} {:>10.1}% {:>9.1}% {:>11} {:>8} {:>7}",
            self.shots,
            share(self.printings),
            share(self.artworks),
            median(&self.candidates),
            median(&self.found),
            median(&self.margins),
        );
    }
}

/// What one photograph scored.
#[derive(Debug)]
pub struct Hit {
    pub printing: bool,
    pub artwork: bool,
    pub candidates: usize,
    pub found: u32,
    pub margin: i64,
}

fn median<T: Copy + Ord + std::fmt::Display>(values: &[T]) -> String {
    if values.is_empty() {
        return "-".to_owned();
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    sorted[sorted.len() / 2].to_string()
}
