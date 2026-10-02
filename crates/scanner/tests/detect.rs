//! Finding a card that was put somewhere known.
//!
//! Drawn rather than photographed: a real card's edge is the thing that
//! wants photographs, and these hold the arithmetic between one and a
//! rectangle.

// A drawn card is put at whole pixels and read back at fractions of one, so
// every cast here crosses between the two.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use manaweb_scanner::Frame;
use manaweb_scanner::detect::{self, Point, Refusal, card, rectify};

const WIDE: usize = 400;
const TALL: usize = 300;

/// A frame of `background` with a `card`-colored rectangle in it.
fn drawn(background: u8, front: u8, x: usize, y: usize, w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![background; WIDE * TALL];
    for down in y..(y + h).min(TALL) {
        for across in x..(x + w).min(WIDE) {
            out[down * WIDE + across] = front;
        }
    }
    out
}

/// Within a pixel or two of where it was put: the grid detection works over
/// is coarser than the frame, so a corner lands on the nearest sample.
fn near(found: Point, x: f32, y: f32, slack: f32) {
    let off = ((found.x - x).powi(2) + (found.y - y).powi(2)).sqrt();
    assert!(
        off <= slack,
        "({}, {}) is {off} from ({x}, {y})",
        found.x,
        found.y
    );
}

#[test]
fn a_light_card_on_a_dark_table_is_found() {
    // 126 by 176 is a card's own ratio at two pixels to the millimeter.
    let levels = drawn(30, 220, 100, 60, 126, 176);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let found = card(&frame).expect("a card in it");

    let [tl, _, br, _] = found.corners;
    near(tl, 100.0, 60.0, 6.0);
    near(br, 225.0, 235.0, 6.0);
}

/// A black border on a white table is the same problem the other way up,
/// and the frame's own edge is what says which.
#[test]
fn a_dark_card_on_a_light_table_is_found() {
    let levels = drawn(235, 20, 140, 40, 126, 176);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let found = card(&frame).expect("a card in it");

    let [tl, _, br, _] = found.corners;
    near(tl, 140.0, 40.0, 6.0);
    near(br, 265.0, 215.0, 6.0);
}

#[test]
fn a_frame_of_nothing_holds_no_card() {
    let levels = vec![128u8; WIDE * TALL];
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    assert!(card(&frame).is_none());
}

/// Something in the background is not what the camera was pointed at.
#[test]
fn a_rectangle_too_small_to_be_meant_is_refused() {
    let levels = drawn(30, 220, 10, 10, 30, 42);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    assert!(card(&frame).is_none());
}

/// A card is 63 by 88, and a table edge or a sheet of paper is not.
#[test]
fn a_rectangle_the_wrong_shape_is_refused() {
    let levels = drawn(30, 220, 40, 100, 320, 80);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    assert!(card(&frame).is_none());
}

/// The corners come back wound one way whatever order they were found in.
#[test]
fn the_corners_read_clockwise_from_the_nearest() {
    let levels = drawn(30, 220, 100, 60, 126, 176);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let [tl, tr, br, bl] = card(&frame).expect("a card in it").corners;

    assert!(tl.x < tr.x, "{tl:?} {tr:?}");
    assert!(tr.y < br.y, "{tr:?} {br:?}");
    assert!(br.x > bl.x, "{br:?} {bl:?}");
    assert!(bl.y > tl.y, "{bl:?} {tl:?}");
}

/// A card seen from low down: its far edge narrower than its near one, and a
/// band across the top of the card itself to say where the top went.
fn tapered(background: u8, front: u8, mark: u8) -> Vec<u8> {
    let mut out = vec![background; WIDE * TALL];
    let (top, bottom) = (40usize, 260usize);
    for down in top..bottom {
        let part = (down - top) as f32 / (bottom - top) as f32;
        let half = 40.0 + part * 40.0;
        let level = if part < 0.3 { mark } else { front };
        for across in (200.0 - half) as usize..(200.0 + half) as usize {
            out[down * WIDE + across] = level;
        }
    }
    out
}

/// Whatever it measured in the frame, a card reads back taller than it is
/// wide and in the proportions one is printed at.
#[test]
fn a_card_on_its_side_is_read_back_standing() {
    let levels = drawn(30, 220, 90, 70, 176, 126);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let found = card(&frame).expect("a card in it");
    let read = rectify(&frame, &found).expect("read back");
    let out = read.frame().expect("a frame");

    assert!(out.height() > out.width(), "{out:?}");
    let ratio = out.width() as f32 / out.height() as f32;
    assert!((ratio - 63.0 / 88.0).abs() < 0.02, "{ratio}");
}

#[test]
fn what_was_on_the_card_reads_back_where_it_was() {
    let mut levels = drawn(30, 150, 100, 60, 126, 176);
    for down in 60..104 {
        for across in 100..163 {
            levels[down * WIDE + across] = 250;
        }
    }
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let found = card(&frame).expect("a card in it");
    let read = rectify(&frame, &found).expect("read back");
    let out = read.frame().expect("a frame");

    let at = |across: f32, down: f32| {
        let x = (out.width() as f32 * across) as usize;
        let y = (out.height() as f32 * down) as usize;
        out.at(x, y).expect("a pixel")
    };
    assert!(at(0.2, 0.1).abs_diff(250) < 20, "{}", at(0.2, 0.1));
    assert!(at(0.8, 0.8).abs_diff(150) < 20, "{}", at(0.8, 0.8));
}

/// The far edge of a card covers less of the frame than the near one, so a
/// band that is straight across the card is not straight across the frame.
#[test]
fn a_card_seen_at_an_angle_reads_back_even() {
    let levels = tapered(30, 150, 250);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let found = card(&frame).expect("a card in it");
    let read = rectify(&frame, &found).expect("read back");
    let out = read.frame().expect("a frame");

    let at = |across: f32, down: f32| {
        let x = (out.width() as f32 * across) as usize;
        let y = (out.height() as f32 * down) as usize;
        out.at(x, y).expect("a pixel")
    };
    for across in [0.15, 0.5, 0.85] {
        assert!(
            at(across, 0.15).abs_diff(250) < 25,
            "{across} {}",
            at(across, 0.15)
        );
        assert!(
            at(across, 0.7).abs_diff(150) < 25,
            "{across} {}",
            at(across, 0.7)
        );
    }
}

/// A table shading off towards one corner, past the card's own level.
///
/// What a card on a lit surface looks like, and what a level alone made of
/// it, is `docs/scanner.md`.
#[test]
fn a_shadow_darker_than_the_card_is_not_part_of_it() {
    let mut levels = vec![0u8; WIDE * TALL];
    for down in 0..TALL {
        let shade = 210 - 185 * down / (TALL - 1);
        for across in 0..WIDE {
            levels[down * WIDE + across] = shade as u8;
        }
    }
    for down in 60..236 {
        for across in 100..226 {
            levels[down * WIDE + across] = 40;
        }
    }

    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let found = card(&frame).expect("a card in it");
    let [tl, _, br, _] = found.corners;
    near(tl, 100.0, 60.0, 8.0);
    near(br, 225.0, 235.0, 8.0);
}

/// Two rectangles sharing a corner, so the outline is an L: convex enough to
/// hull, and nothing like four corners.
fn bent(background: u8, front: u8) -> Vec<u8> {
    let mut out = vec![background; WIDE * TALL];
    for down in 60..240 {
        for across in 100..160 {
            out[down * WIDE + across] = front;
        }
    }
    for down in 180..240 {
        for across in 160..300 {
            out[down * WIDE + across] = front;
        }
    }
    out
}

/// The check the photographs turn on, and the one nothing else here reaches:
/// an outline that is not four straight edges leaves most of its own hull
/// outside the four corners fitted in it.
#[test]
fn an_outline_that_is_not_a_quadrilateral_is_refused() {
    let levels = bent(30, 220);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");

    assert!(card(&frame).is_none());
    let read = detect::reading(&frame);
    assert_eq!(read.refused, Some(Refusal::Fill));
}

/// Two rectangles sharing an edge, filling so much of the frame that the
/// flood has almost nowhere to reach: the table check and the hull test both
/// fail, which is what tells an insisting refusal from an overwriting one.
fn sprawling(background: u8, front: u8) -> Vec<u8> {
    let mut out = vec![background; WIDE * TALL];
    for down in 4..296 {
        for across in 4..260 {
            out[down * WIDE + across] = front;
        }
    }
    for down in 120..296 {
        for across in 260..396 {
            out[down * WIDE + across] = front;
        }
    }
    out
}

/// The first check to refuse is the one named, and every check after it
/// leaves that name alone. Nothing else here fails two at once, so without
/// this the order the checks run in is unpinned.
#[test]
fn the_check_that_refuses_first_is_the_one_named() {
    let levels = sprawling(30, 220);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let read = detect::reading(&frame);

    assert!(read.table < detect::LEAST_TABLE, "{read:?}");
    assert!(read.fill < detect::LEAST_FILL, "{read:?}");
    assert_eq!(read.refused, Some(Refusal::Table), "{read:?}");
    assert!(card(&frame).is_none());
}

/// Shape is asked before area, and a sliver fails both: too far from a
/// card's ratio and too little of the frame to have been the one meant.
#[test]
fn a_sliver_is_refused_for_its_shape_rather_than_its_size() {
    let levels = drawn(30, 220, 100, 100, 60, 15);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let read = detect::reading(&frame);

    assert!(
        (read.ratio - detect::RATIO).abs() > detect::RATIO_SLACK,
        "{read:?}"
    );
    assert!(read.covering < detect::LEAST_AREA, "{read:?}");
    assert_eq!(read.refused, Some(Refusal::Shape), "{read:?}");
}

/// A frame too small to sample down to a grid worth walking.
#[test]
fn a_frame_too_shallow_to_grid_is_refused() {
    let levels = vec![128u8; WIDE * 5];
    let frame = Frame::new(&levels, WIDE, 5, WIDE).expect("a frame");

    assert_eq!(detect::reading(&frame).refused, Some(Refusal::Grid));
    assert!(card(&frame).is_none());
}

/// A line has no four corners to fit, which is a different refusal from a
/// shape that has them and is the wrong one.
#[test]
fn an_outline_with_no_four_corners_is_refused() {
    let levels = drawn(30, 220, 200, 40, 2, 220);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");

    assert_eq!(detect::reading(&frame).refused, Some(Refusal::Corners));
    assert!(card(&frame).is_none());
}

/// A refusal names the check that made it, not the first one that could have.
#[test]
fn a_refusal_names_its_own_check() {
    let refused = |levels: &[u8]| {
        let frame = Frame::new(levels, WIDE, TALL, WIDE).expect("a frame");
        detect::reading(&frame).refused
    };

    // A card too far off to have been the one meant, which passes every
    // check before the last.
    assert_eq!(
        refused(&drawn(30, 220, 10, 10, 30, 42)),
        Some(Refusal::Area)
    );
    // Wide and flat: a card's ratio is the only thing wrong with it.
    assert_eq!(
        refused(&drawn(30, 220, 40, 100, 320, 80)),
        Some(Refusal::Shape)
    );
    // Nothing standing off the surface at all.
    assert_eq!(refused(&vec![128u8; WIDE * TALL]), Some(Refusal::Nothing));
    // All but a border of it is card, so there is too little table.
    assert_eq!(
        refused(&drawn(30, 220, 8, 8, 384, 284)),
        Some(Refusal::Table)
    );
}

/// What a sweep is read off: the measurements are taken past the check that
/// refused them, so one pass answers for a threshold that was not shipped.
#[test]
fn a_reading_measures_past_the_check_that_refused_it() {
    let levels = drawn(30, 220, 8, 8, 384, 284);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");
    let read = detect::reading(&frame);

    assert_eq!(read.refused, Some(Refusal::Table));
    assert!(read.quad.is_none());
    // Nearly all of it is card, so the flood had almost nowhere to reach.
    assert!(read.table < detect::LEAST_TABLE, "{read:?}");
    for held in [read.run, read.fill, read.ratio, read.covering] {
        assert!(held.is_finite(), "{read:?}");
    }
}

/// The step is the one thing a sweep varies and the pipeline cannot answer
/// twice, so what pins it is the value either side of where it stops working.
#[test]
fn a_flood_stops_climbing_at_the_step_it_is_given() {
    // The drawn card stands 190 levels off the table, so a step that far is
    // the first one the flood can climb.
    let levels = drawn(30, 220, 100, 60, 126, 176);
    let frame = Frame::new(&levels, WIDE, TALL, WIDE).expect("a frame");

    assert!(detect::reading_at(&frame, 189).quad.is_some());
    assert_eq!(
        detect::reading_at(&frame, 190).refused,
        Some(Refusal::Nothing),
        "the flood reached the card, so nothing was left to be it",
    );
    assert_eq!(detect::reading(&frame).quad, card(&frame));
}
