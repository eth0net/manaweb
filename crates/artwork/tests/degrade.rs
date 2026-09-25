//! What a simulated photograph retrieves from the entries the index holds.
//!
//! The number that matters is `just measure-art` over fifty thousand real
//! images. This asks only whether each degradation is survivable at all,
//! which is what a change to one of them can break.
//!
//! Rotation is the one that needs the framings on both sides: it swings the
//! corners out of the picture, and asked at one framing alone it retrieves
//! the wrong artwork of three here.

use image::{DynamicImage, RgbImage};
use manaweb_artwork::degrade;
use manaweb_artwork::luma::Plane;
use manaweb_scanner::hash::{self, distance, entry, phash};

/// Structure at several scales, because a hash of a flat field says nothing.
/// `seed` moves the pattern without changing its character.
fn artwork(seed: u32) -> DynamicImage {
    let mut image = RgbImage::new(240, 170);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let (x, y) = (x.wrapping_mul(seed | 1), y.wrapping_add(seed));
        let coarse = (x / 37 + y / 23) % 5;
        let fine = (x * 7 + y * 13 + seed) % 97;
        let level = u8::try_from((coarse * 40 + fine / 3) % 256).unwrap_or(0);
        *pixel = image::Rgb([level, level.wrapping_add(40), level.wrapping_sub(20)]);
    }
    DynamicImage::ImageRgb8(image)
}

/// The artworks a query is asked to choose between, the first being the one
/// every query is made from.
const SEEDS: [u32; 3] = [5, 9, 13];

#[test]
fn a_degraded_query_still_picks_its_own_artwork() {
    let images: Vec<DynamicImage> = SEEDS.iter().map(|&seed| artwork(seed)).collect();
    let index: Vec<[u64; 4]> = images
        .iter()
        .map(|image| entry(&Plane::new(image).frame().expect("a frame")))
        .collect();

    for degradation in degrade::ALL {
        let plane = Plane::new(&(degradation.apply)(&images[0]));
        let query = plane.frame().expect("a frame");
        // Several framings of the query against several of the artwork, which
        // is how a scanner asks — see `docs/scanner.md`.
        let asked: Vec<u64> = hash::INSETS
            .iter()
            .map(|&inset| phash(&query.inset(inset)))
            .collect();

        let nearest = |held: &[u64; 4]| {
            held.iter()
                .flat_map(|&held| asked.iter().map(move |&asked| distance(held, asked)))
                .min()
        };
        let (at, _) = index
            .iter()
            .enumerate()
            .min_by_key(|(_, held)| nearest(held))
            .expect("an artwork");

        assert_eq!(at, 0, "{} picked artwork {at}", degradation.name);
    }
}
