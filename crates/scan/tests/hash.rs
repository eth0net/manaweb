//! What the hashes do to an image that has been through something.
//!
//! Synthetic rather than real artwork: these pin the properties the index
//! rests on, and what a hash retrieves out of fifty thousand real ones is a
//! measurement rather than an assertion — `just measure-art`.

use image::{DynamicImage, RgbImage};
use manaweb_scan::degrade;
use manaweb_scan::hash::{dhash, distance, phash};

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

#[test]
fn an_artwork_hashes_to_itself() {
    let image = artwork(1);
    assert_eq!(dhash(&image), dhash(&artwork(1)));
    assert_eq!(phash(&image), phash(&artwork(1)));
}

#[test]
fn two_artworks_are_far_apart() {
    let (a, b) = (artwork(1), artwork(9));
    assert!(distance(dhash(&a), dhash(&b)) > 16);
    assert!(distance(phash(&a), phash(&b)) > 16);
}

/// The lighting and the lens are what a hash is chosen to survive.
#[test]
fn a_blurred_artwork_stays_near_its_own_hash() {
    let image = artwork(3);
    let soft = image.blur(1.5);
    assert!(distance(dhash(&image), dhash(&soft)) <= 4);
    assert!(distance(phash(&image), phash(&soft)) <= 4);
}

/// The measured finding this crate exists to act on: framing is the one
/// degradation a global hash does not shrug off.
#[test]
fn a_crop_moves_a_hash_further_than_a_blur_does() {
    let image = artwork(5);
    let soft = image.blur(1.5);
    let framed = degrade::window(&image, degrade::MISFRAME);

    assert!(distance(phash(&image), phash(&framed)) > distance(phash(&image), phash(&soft)));
}

/// Which is why the index holds an artwork at the insets a scanner is
/// likeliest to be off by, rather than only at Scryfall's own framing. The
/// query is off-center and lands on none of them, or this would be measuring
/// the two calls agreeing.
#[test]
fn indexing_the_crop_too_brings_it_back() {
    let image = artwork(7);
    let framed = degrade::window(&image, degrade::MISFRAME);
    let asked = phash(&framed);

    let alone = distance(phash(&image), asked);
    let held = [0.0, 0.03, 0.06, 0.09]
        .into_iter()
        .map(|inset| distance(phash(&degrade::inset(&image, inset)), asked))
        .min()
        .unwrap();

    assert!(held < alone, "held {held} against {alone}");
}
