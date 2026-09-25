//! Finding a card that was put somewhere known.
//!
//! Drawn rather than photographed: a real card's edge is the thing that
//! wants photographs, and these hold the arithmetic between one and a
//! rectangle.

use manaweb_scanner::Frame;
use manaweb_scanner::detect::{Point, card};

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
