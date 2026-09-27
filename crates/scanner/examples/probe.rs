//! What the engine answers over two frames it makes itself, a line each.
//!
//!     cargo run -p manaweb-scanner --example probe
//!
//! What `tools/scanner-check` holds a wasm build to, so the two targets have
//! one statement of the numbers between them rather than a copy each. Floats
//! go out as their bits: two builds that agree exactly still print a decimal
//! each, and only the bits say whether they did.

use manaweb_scanner::detect;
use manaweb_scanner::hash::{PROBE, entry, probe};
use manaweb_scanner::luma::plane;
use manaweb_scanner::{Frame, fingerprint, query};

/// Width and height of the frame a card is drawn in.
const TABLE: (usize, usize) = (400, 300);

/// Where it is drawn, and how big: a card's own ratio at two pixels to the
/// millimeter.
const DRAWN: (usize, usize, usize, usize) = (100, 60, 126, 176);

/// A card on a table, the card carrying a gradient so that hashing one says
/// something and the table flat so that finding one can.
///
/// Arithmetic a port can restate rather than a fixture it has to ship.
fn table() -> Vec<u8> {
    let (width, height) = TABLE;
    let (x, y, wide, tall) = DRAWN;
    let mut out = vec![30u8; width * height];
    for down in y..y + tall {
        for across in x..x + wide {
            let level = (across - x) * 7 + (down - y) * 11;
            out[down * width + across] = 140 + u8::try_from(level % 100).unwrap_or(0);
        }
    }
    out
}

fn main() {
    let (width, height) = PROBE;
    let levels = plane(&probe(), 3);
    let frame = Frame::new(&levels, width, height, width).expect("the probe is a frame");
    print!("entry");
    for hash in entry(&frame) {
        print!(" {hash:016x}");
    }
    println!();
    println!("fingerprint {:016x}", fingerprint());

    let (width, height) = TABLE;
    let levels = table();
    let frame = Frame::new(&levels, width, height, width).expect("the table is a frame");

    let found = detect::card(&frame).expect("a card on the table");
    print!("detect");
    for corner in found.corners {
        print!(" {:08x} {:08x}", corner.x.to_bits(), corner.y.to_bits());
    }
    println!();

    let (wide, tall) = detect::size(&found);
    let read = detect::rectify(&frame, &found).expect("a card read back");
    let card = read.frame().expect("the card is a frame");
    println!("rectify {wide} {tall} {:016x}", entry(&card)[0]);

    let asked = query::query(&frame);
    print!(
        "query {} {}",
        asked.hashes.len(),
        u8::from(asked.found.is_some())
    );
    for hash in &asked.hashes {
        print!(" {hash:016x}");
    }
    println!();
    println!("words {}", query::MOST);
}
