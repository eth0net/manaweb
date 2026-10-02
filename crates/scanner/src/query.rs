//! A photograph, turned into the hashes the index is asked for.
//!
//! Why a card is looked for before a frame is cut by guesswork, and what the
//! guesses cost when one was found, is `docs/scanner.md`.

use crate::art::{BOXES, Rect};
use crate::detect::{self, Quad};
use crate::hash::{Frame, HASHES, Hash, entry};

/// How much of a photograph's height the card is taken to fill, for when
/// nothing is detected and a phone will not focus on a card against its lens.
///
/// Every one is tried and the nearest kept.
pub const FILLS: [f32; 5] = [1.0, 0.85, 0.72, 0.6, 0.5];

/// The most hashes one [`query`] comes to, which is the room a caller wants.
///
/// A card that was found is read back both ways up, and a frame it was not
/// found in is cut [`FILLS`] ways, so the deeper of those two sets it.
pub const MOST: usize = (if FILLS.len() > 2 { FILLS.len() } else { 2 }) * BOXES.len() * HASHES;

/// The middle of a frame, `fill` of it tall and a card's own shape.
///
/// Its shape and not the frame's: a phone shoots four by three and a card is
/// 63 by 88, so insetting both axes alike leaves the art box stretched by the
/// difference.
// A fill is a fraction of a frame and a frame is pixels, so the casts are
// that crossing.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn filling(frame: &Frame, fill: f32) -> Rect {
    let (across, down) = (frame.width() as f32, frame.height() as f32);
    let tall = (fill.clamp(0.1, 1.0) * down).min(across / detect::RATIO);
    let (half_wide, half_tall) = (tall * detect::RATIO / across / 2.0, tall / down / 2.0);
    Rect {
        left: 0.5 - half_wide,
        top: 0.5 - half_tall,
        right: 0.5 + half_wide,
        bottom: 0.5 + half_tall,
    }
}

/// Every art box of one card, the shape of it not being known.
#[must_use]
pub fn boxed(card: &Frame) -> Vec<Hash> {
    BOXES
        .iter()
        .filter_map(|held| Some(entry(&held.of(card)?)))
        .flatten()
        .collect()
}

/// What one photograph asks the index, and what framed the asking.
#[derive(Debug, Clone)]
pub struct Query {
    /// At most [`MOST`], and empty for a frame no box could be cut from.
    pub hashes: Vec<Hash>,
    /// The card detection found, where that is what the hashes came from.
    pub found: Option<Quad>,
}

/// One photograph as the index is asked for it.
#[must_use]
pub fn query(frame: &Frame) -> Query {
    // todo(scanner): a quad too square to orient is read a quarter turn and
    // asks for hashes nothing holds — `docs/scanner.md`.
    let found = detect::card(frame);
    let mut hashes = Vec::with_capacity(MOST);
    for quad in found.iter().flat_map(|quad| [*quad, quad.turned()]) {
        let Some(read) = detect::rectify(frame, &quad) else {
            continue;
        };
        let Some(card) = read.frame() else { continue };
        hashes.extend(boxed(&card));
    }
    if !hashes.is_empty() {
        return Query { hashes, found };
    }

    hashes.extend(
        FILLS
            .iter()
            .filter_map(|&fill| Some(boxed(&filling(frame, fill).of(frame)?)))
            .flatten(),
    );
    Query {
        hashes,
        found: None,
    }
}
