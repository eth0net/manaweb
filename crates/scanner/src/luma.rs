//! Color to the one channel the hashing reads.
//!
//! What it costs for two sides to do this differently is `docs/scryfall.md`.

/// Rec.709, weighted per ten thousand and truncated, which is what an image
/// decoder gives.
const WEIGHTS: [u32; 3] = [2126, 7152, 722];
const PER: u32 = 10_000;

/// One level from a pixel's red, green and blue.
#[must_use]
pub fn level(red: u8, green: u8, blue: u8) -> u8 {
    let held =
        WEIGHTS[0] * u32::from(red) + WEIGHTS[1] * u32::from(green) + WEIGHTS[2] * u32::from(blue);
    u8::try_from((held + PER / 2) / PER).unwrap_or(u8::MAX)
}

/// One level per pixel of `pixels`, which carries `step` bytes each.
///
/// `step` is 3 for a decoder's RGB and 4 for a canvas's RGBA; alpha is passed
/// over rather than composited, since an artwork has none and a camera gives
/// none. Empty for a step narrower than a color.
#[must_use]
pub fn plane(pixels: &[u8], step: usize) -> Vec<u8> {
    if step < 3 {
        return Vec::new();
    }
    pixels
        .chunks_exact(step)
        .map(|pixel| level(pixel[0], pixel[1], pixel[2]))
        .collect()
}
