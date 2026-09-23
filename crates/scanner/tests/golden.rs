//! One stated input, one expected hash.
//!
//! The builder fills the index and a browser queries it. They agree or every
//! lookup misses, and neither side can tell that is what happened — so the
//! input is arithmetic anyone can restate, rather than a fixture to ship.
//!
//! todo(scanner): run these on wasm32 too. CI runs the three native targets,
//! which is not the one the crate was split out to serve.

use manaweb_scanner::fingerprint;
use manaweb_scanner::hash::{Frame, PROBE, dhash, entry, phash, probe};

/// Measured 2026-09-24 on aarch64-apple-darwin. A build that disagrees has
/// changed the hash, and every store and every published index holds the old
/// one.
const DHASH: u64 = 0x1831_c78c_1873_c68c;
const PHASH: u64 = 0x0da6_0fa4_0f5a_f0da;
const ENTRY: [u64; 4] = [
    0x0da6_0fa4_0f5a_f0da,
    0x0da4_8ea4_0f5a_f45e,
    0x32a4_f2a4_0f5e_0b5e,
    0x33e5_b3a0_0b5a_0b5e,
];

#[test]
fn the_hashes_are_what_they_have_always_been() {
    let (width, height) = PROBE;
    let levels = probe();
    let frame = Frame::new(&levels, width, height, width).expect("a frame");

    assert_eq!(dhash(&frame), DHASH, "dhash {:#018x}", dhash(&frame));
    assert_eq!(phash(&frame), PHASH, "phash {:#018x}", phash(&frame));
    assert_eq!(entry(&frame), ENTRY, "entry {:#018x?}", entry(&frame));

    // Over this same frame, so it is these entries folded rather than a
    // number of its own to keep in step with them.
    assert_eq!(fingerprint(), FINGERPRINT, "{:#018x}", fingerprint());
}

/// What a store and a published index are stamped with.
const FINGERPRINT: u64 = 0x6c61_8393_dccd_0d94;
