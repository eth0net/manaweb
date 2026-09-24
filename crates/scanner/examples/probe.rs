//! The probe frame's entry and fingerprint, as hex, one per line.
//!
//!     cargo run -p manaweb-scanner --example probe
//!
//! What `tools/scanner-check` holds a wasm build to, so the two targets have
//! one statement of the numbers between them rather than a copy each.

use manaweb_scanner::hash::{PROBE, entry, probe};
use manaweb_scanner::luma::plane;
use manaweb_scanner::{Frame, fingerprint};

fn main() {
    let (width, height) = PROBE;
    let levels = plane(&probe(), 3);
    let frame = Frame::new(&levels, width, height, width).expect("the probe is a frame");

    for hash in entry(&frame) {
        println!("{hash:016x}");
    }
    println!("{:016x}", fingerprint());
}
