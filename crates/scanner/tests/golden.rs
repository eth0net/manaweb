//! One stated input, one expected hash.
//!
//! The builder fills the index and a browser queries it. They agree or every
//! lookup misses, and neither side can tell that is what happened — so the
//! input is arithmetic anyone can restate, rather than a fixture to ship.
//!
//! Native only: `tools/scanner-check` compiles the crate to wasm32 and holds
//! that build to what this one answers.

use manaweb_scanner::fingerprint;
use manaweb_scanner::hash::{Frame, PROBE, dhash, entry, phash, probe};
use manaweb_scanner::luma::{level, plane};

/// Measured 2026-09-24 on aarch64-apple-darwin. A build that disagrees has
/// changed the hash, and every store and every published index holds the old
/// one.
const DHASH: u64 = 0x2969_4bda_92b6_a4a4;
const PHASH: u64 = 0x2e54_01a3_0ddb_357e;
const ENTRY: [u64; 4] = [
    0x2e54_01a3_0ddb_357e,
    0x7e54_01a3_0ddb_157a,
    0x76f4_a1a3_099a_097e,
    0x56fc_a9a3_4b92_0b16,
];

#[test]
fn the_hashes_are_what_they_have_always_been() {
    let (width, height) = PROBE;
    let levels = plane(&probe(), 3);
    let frame = Frame::new(&levels, width, height, width).expect("a frame");

    assert_eq!(dhash(&frame), DHASH, "dhash {:#018x}", dhash(&frame));
    assert_eq!(phash(&frame), PHASH, "phash {:#018x}", phash(&frame));
    assert_eq!(entry(&frame), ENTRY, "entry {:#018x?}", entry(&frame));

    // Over this same frame, so it is these entries folded rather than a
    // number of its own to keep in step with them.
    assert_eq!(fingerprint(), FINGERPRINT, "{:#018x}", fingerprint());
}

/// What a store and a published index are stamped with.
const FINGERPRINT: u64 = 0x1c1f_64e9_91d4_d1cc;

/// The one step of the hashing a frame of levels arrives too late to state.
#[test]
fn a_color_reaches_one_level() {
    // Weighted per ten thousand and rounded: pure green carries most of it,
    // and a gray stays exactly itself.
    assert_eq!(level(0, 0, 0), 0);
    assert_eq!(level(255, 255, 255), 255);
    assert_eq!(level(255, 0, 0), 54);
    assert_eq!(level(0, 255, 0), 182);
    assert_eq!(level(0, 0, 255), 18);
    assert_eq!(level(217, 212, 209), 213);
    for at in 0..=255 {
        assert_eq!(level(at, at, at), at, "gray {at}");
    }

    // Alpha is passed over rather than composited.
    assert_eq!(plane(&[9, 9, 9, 0, 40, 40, 40, 255], 4), vec![9, 40]);
    assert!(plane(&[1, 2], 2).is_empty());
}
