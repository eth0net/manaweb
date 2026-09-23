//! Perceptual hashes of an artwork, and the distance between two.
//!
//! Which one the index ships, and what it was measured at, is in
//! `docs/roadmap.md`.

use image::imageops::FilterType;
use image::{DynamicImage, GrayImage};

/// Every hash here is 64 bits, so one comparison is a `xor` and a `popcount`.
pub type Hash = u64;

/// Side of the grid a [`phash`] runs its transform over.
const DCT_SIDE: usize = 32;

/// The same, as the resize wants it.
const DCT_PIXELS: u32 = 32;

/// And again as the transform's own divisor.
const SIDE: f32 = 32.0;

/// How many low frequencies of that transform the hash keeps, per axis.
const DCT_KEPT: usize = 8;

/// Bits differing between two hashes.
#[must_use]
pub fn distance(a: Hash, b: Hash) -> u32 {
    (a ^ b).count_ones()
}

/// Each bit says whether a pixel is brighter than the one to its right.
///
/// Gradients rather than levels, so it survives the exposure difference
/// between a scan and a photograph of the same card.
#[must_use]
pub fn dhash(image: &DynamicImage) -> Hash {
    let grid = grayscale(image, 9, 8);

    let mut hash = 0;
    for row in grid.rows() {
        let levels: Vec<u8> = row.map(|pixel| pixel.0[0]).collect();
        for pair in levels.windows(2) {
            hash = (hash << 1) | u64::from(pair[0] > pair[1]);
        }
    }
    hash
}

/// Each bit says whether one low frequency of the image is above their median.
///
/// The median rather than the mean, so a handful of extreme coefficients can't
/// carry every bit with them.
#[must_use]
pub fn phash(image: &DynamicImage) -> Hash {
    let grid = grayscale(image, DCT_PIXELS, DCT_PIXELS);

    let mut rows = [[0f32; DCT_SIDE]; DCT_SIDE];
    for (y, row) in grid.rows().enumerate() {
        for (x, pixel) in row.enumerate() {
            rows[y][x] = f32::from(pixel.0[0]);
        }
    }

    let freqs = dct_2d(&rows);

    // The DC term is the average brightness, which says nothing about the
    // image and would swamp the median if it were included.
    let mut kept = Vec::with_capacity(DCT_KEPT * DCT_KEPT - 1);
    for (y, row) in freqs.iter().enumerate().take(DCT_KEPT) {
        for (x, freq) in row.iter().enumerate().take(DCT_KEPT) {
            if (x, y) != (0, 0) {
                kept.push(*freq);
            }
        }
    }

    let mut sorted = kept.clone();
    sorted.sort_unstable_by(f32::total_cmp);
    let median = sorted[sorted.len() / 2];

    let mut hash = 0;
    for freq in kept.into_iter().take(64) {
        hash = (hash << 1) | u64::from(freq > median);
    }
    hash
}

fn grayscale(image: &DynamicImage, width: u32, height: u32) -> GrayImage {
    // Triangle over Lanczos: the query is a camera frame that has already been
    // resampled once, and the sharper filter only sharpens that difference.
    image
        .resize_exact(width, height, FilterType::Triangle)
        .into_luma8()
}

/// Separable DCT-II, the rows then the columns.
fn dct_2d(input: &[[f32; DCT_SIDE]; DCT_SIDE]) -> [[f32; DCT_SIDE]; DCT_SIDE] {
    let mut rows = [[0f32; DCT_SIDE]; DCT_SIDE];
    for (y, row) in input.iter().enumerate() {
        rows[y] = dct_1d(row);
    }

    let mut out = [[0f32; DCT_SIDE]; DCT_SIDE];
    let mut column = [0f32; DCT_SIDE];
    for x in 0..DCT_SIDE {
        for y in 0..DCT_SIDE {
            column[y] = rows[y][x];
        }
        let transformed = dct_1d(&column);
        for y in 0..DCT_SIDE {
            out[y][x] = transformed[y];
        }
    }
    out
}

fn dct_1d(input: &[f32; DCT_SIDE]) -> [f32; DCT_SIDE] {
    let mut out = [0f32; DCT_SIDE];
    for (k, cell) in out.iter_mut().enumerate() {
        let mut sum = 0f32;
        let k = f32::from(u16::try_from(k).unwrap_or(u16::MAX));
        for (n, value) in input.iter().enumerate() {
            let n = f32::from(u16::try_from(n).unwrap_or(u16::MAX));
            let angle = std::f32::consts::PI * (2.0 * n + 1.0) * k / (2.0 * SIDE);
            sum += value * angle.cos();
        }
        *cell = sum;
    }
    out
}
