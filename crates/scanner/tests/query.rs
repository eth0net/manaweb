//! Which of a query's two paths answered, over frames put together here.
//!
//! The cascade is the one thing a browser and `just photos` both run, so what
//! it asks the index at is worth pinning either way round.

// A drawn frame is whole pixels and a framing is a fraction of one, so the
// casts here cross between the two.
#![allow(clippy::cast_precision_loss)]

use manaweb_scanner::Frame;
use manaweb_scanner::art::BOXES;
use manaweb_scanner::detect::RATIO;
use manaweb_scanner::hash::HASHES;
use manaweb_scanner::query::{self, FILLS, MOST};

const WIDE: usize = 400;
const TALL: usize = 300;

/// Both ways up, a card's top not being known while it is being read.
const TURNS: usize = 2;

/// A flat surface with one lighter rectangle standing off it.
fn surface(x: usize, y: usize, wide: usize, tall: usize) -> Vec<u8> {
    let mut out = vec![30u8; WIDE * TALL];
    for down in y..(y + tall).min(TALL) {
        for across in x..(x + wide).min(WIDE) {
            // Varied, so that what is hashed out of it is not one flat field.
            let level = (across * 7 + down * 11) % 100;
            out[down * WIDE + across] = 140 + u8::try_from(level).unwrap_or(0);
        }
    }
    out
}

fn asked(levels: &[u8]) -> query::Query {
    let frame = Frame::new(levels, WIDE, TALL, WIDE).expect("a frame");
    query::query(&frame)
}

/// 126 by 176 is a card's own ratio at two pixels to the millimeter.
const CARD: (usize, usize, usize, usize) = (100, 60, 126, 176);

/// And one too big for the surface it would have to be lying on.
const FILLED: (usize, usize, usize, usize) = (0, 0, WIDE, 260);

#[test]
fn a_card_in_the_frame_is_what_frames_the_query() {
    let (x, y, wide, tall) = CARD;
    let held = asked(&surface(x, y, wide, tall));

    assert!(held.found.is_some(), "no card in a frame with one in it");
    assert_eq!(held.hashes.len(), TURNS * BOXES.len() * HASHES);
}

#[test]
fn a_frame_with_no_card_in_it_is_guessed_at() {
    let (x, y, wide, tall) = FILLED;
    let held = asked(&surface(x, y, wide, tall));

    assert!(held.found.is_none(), "a card where none could be lying");
    assert_eq!(held.hashes.len(), FILLS.len() * BOXES.len() * HASHES);
}

/// What a caller makes room for, and the C ABI copies without re-checking.
#[test]
fn neither_path_asks_more_than_most() {
    for (x, y, wide, tall) in [CARD, FILLED] {
        assert!(asked(&surface(x, y, wide, tall)).hashes.len() <= MOST);
    }
}

/// A phone shoots four by three and a card is 63 by 88, so a guess that inset
/// both axes alike would hand the art boxes a stretched card.
#[test]
fn a_guessed_framing_is_a_cards_shape_and_not_the_frames() {
    let levels = surface(0, 0, 0, 0);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");

    for fill in FILLS {
        let held = query::filling(&frame, fill);
        let across = (held.right - held.left) * WIDE as f32;
        let down = (held.bottom - held.top) * TALL as f32;
        assert!(
            (across / down - RATIO).abs() < 0.01,
            "{fill} of the frame is {across} by {down}"
        );
    }
}
