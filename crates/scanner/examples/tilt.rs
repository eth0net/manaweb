//! What each of the detector's checks makes of a card leaned away from the
//! camera, at angles nothing was photographed at.
//!
//!     cargo run --release -p manaweb-scanner --example tilt
//!
//! Drawn rather than photographed so that the lean is the only thing moving:
//! a real card also keeps a bow, which the second column varies on its own.

// A card is millimeters and a frame is pixels, so every cast here crosses
// between the two.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use manaweb_scanner::Frame;
use manaweb_scanner::detect::{self, Refusal};

/// Width and height of the frame a card is drawn in, matching a capture.
const SIDE: usize = 1280;

const TABLE: u8 = 90;
const CARD: u8 = 170;

/// A card in millimeters, and how far above the table the camera is.
const WIDE: f32 = 63.0;
const TALL: f32 = 88.0;
const AWAY: f32 = 300.0;

/// Focal length in pixels, set so a card lying flat covers three fifths of
/// the frame's height, which is what the photographs were taken at.
const LENS: f32 = 0.6 * SIDE as f32 * AWAY / TALL;

/// How finely the card's own surface is sampled into the frame. Dense enough
/// that no pixel of it is missed at the steepest lean below.
const STEPS: usize = 2400;

/// A card on a table, `lean` degrees away from the camera and bowed `bow`
/// millimeters off its own plane.
fn shot(lean: f32, bow: f32) -> Vec<u8> {
    let mut out = vec![TABLE; SIDE * SIDE];
    let (sin, cos) = lean.to_radians().sin_cos();
    let middle = SIDE as f32 / 2.0;

    for down in 0..=STEPS {
        let along = TALL * (down as f32 / STEPS as f32 - 0.5);
        // Deepest at the middle of its length, which is how a played card sits.
        let lift = bow * (1.0 - (2.0 * along / TALL).powi(2));
        let (y, z) = (
            along.mul_add(cos, -(lift * sin)),
            along.mul_add(sin, lift * cos),
        );
        let scale = LENS / (AWAY - z);

        for across in 0..=STEPS {
            let side = WIDE * (across as f32 / STEPS as f32 - 0.5);
            let (x, y) = (side.mul_add(scale, middle), y.mul_add(scale, middle));
            if x < 0.0 || y < 0.0 {
                continue;
            }
            let (x, y) = (x as usize, y as usize);
            if x < SIDE && y < SIDE {
                out[y * SIDE + x] = CARD;
            }
        }
    }
    out
}

/// The leans asked about, in degrees.
// Five degrees apart, and a tenth apart either side of 44, which is where
// the corner ordering stops agreeing about which way up the card is.
const LEANS: [f32; 17] = [
    0.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 44.0, 44.2, 44.3, 44.4, 45.0, 50.0, 55.0,
    60.0,
];

/// And the bows, in millimeters off the card's own plane.
const BOWS: [f32; 3] = [0.0, 1.5, 3.0];

/// Whether the side the corners call the card's length is the one it was
/// drawn along, which here is the frame's own vertical.
fn standing(quad: &detect::Quad) -> bool {
    let [top, _, _, left] = quad.corners;
    (left.y - top.y).abs() > (left.x - top.x).abs()
}

fn main() {
    println!(
        "{:>5} {:>5} {:>9} {:>7} {:>7} {:>7} {:>9} {:>8}",
        "lean", "bow", "verdict", "table", "fill", "ratio", "covering", "standing"
    );
    for bow in BOWS {
        for lean in LEANS {
            let levels = shot(lean, bow);
            let frame = Frame::new(&levels, SIDE, SIDE, SIDE).expect("the table is a frame");
            let read = detect::reading(&frame);
            println!(
                "{lean:>5.1} {bow:>5.1} {:>9} {:>7.3} {:>7.3} {:>7.3} {:>9.3} {:>8}",
                read.refused.map_or("found", Refusal::name),
                read.table,
                read.fill,
                read.ratio,
                read.covering,
                read.quad.map_or("-", |quad| if standing(&quad) {
                    "yes"
                } else {
                    "on its side"
                }),
            );
        }
    }
}
