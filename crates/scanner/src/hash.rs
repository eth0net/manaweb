//! Perceptual hashes of an artwork, and the distance between two.
//!
//! Which hash the index ships, and what it was measured at, is in
//! `docs/roadmap.md`.

// Resampling is arithmetic between one pixel grid and a smaller one, so every
// cast here is a coordinate crossing between the two.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

/// Every hash here is 64 bits, so one comparison is a `xor` and a `popcount`.
pub type Hash = u64;

/// Hashes an artwork carries, one per entry in [`INSETS`].
pub const HASHES: usize = 4;

/// A framing error is the one thing a hash does not survive, so an artwork is
/// held at the insets a scanner is likeliest to be off by.
pub const INSETS: [f32; HASHES] = [0.0, 0.03, 0.06, 0.09];

/// Side of the grid a [`phash`] runs its transform over.
const DCT_SIDE: usize = 32;

/// The same, as the transform's own divisor.
const SIDE: f32 = 32.0;

/// How many low frequencies of that transform the hash keeps, per axis.
const DCT_KEPT: usize = 8;

/// A grayscale image, or a window onto one.
///
/// Stride apart from width because a camera's rows carry padding past the
/// pixels — see `docs/roadmap.md`.
#[derive(Debug, Clone, Copy)]
pub struct Frame<'a> {
    luma: &'a [u8],
    width: usize,
    height: usize,
    stride: usize,
}

impl<'a> Frame<'a> {
    /// Wraps a luma plane.
    ///
    /// Returns `None` for an empty frame, a stride narrower than the width,
    /// or a buffer the last row does not fit in.
    #[must_use]
    pub fn new(luma: &'a [u8], width: usize, height: usize, stride: usize) -> Option<Self> {
        if width == 0 || height == 0 || stride < width {
            return None;
        }
        let wanted = (height - 1).checked_mul(stride)?.checked_add(width)?;
        (luma.len() >= wanted).then_some(Self {
            luma,
            width,
            height,
            stride,
        })
    }

    #[must_use]
    pub fn width(&self) -> usize {
        self.width
    }

    #[must_use]
    pub fn height(&self) -> usize {
        self.height
    }

    /// A rectangle of the frame, sharing its pixels rather than copying them.
    ///
    /// Returns `None` for an empty rectangle or one reaching past an edge.
    #[must_use]
    pub fn window(&self, x: usize, y: usize, width: usize, height: usize) -> Option<Self> {
        // Checked, not because a rectangle is likely to be that big but
        // because these numbers cross a boundary from whatever is calling.
        if width == 0
            || height == 0
            || x.checked_add(width)? > self.width
            || y.checked_add(height)? > self.height
        {
            return None;
        }
        Some(Self {
            luma: &self.luma[y * self.stride + x..],
            width,
            height,
            stride: self.stride,
        })
    }

    /// The frame with `fraction` of it taken off each edge.
    #[must_use]
    pub fn inset(&self, fraction: f32) -> Self {
        // Past nine tenths there is no frame left, and a fraction arriving as
        // NaN truncates to nothing rather than to a panic.
        let fraction = fraction.clamp(0.0, 0.45);
        let x = (self.width as f32 * fraction) as usize;
        let y = (self.height as f32 * fraction) as usize;
        self.window(x, y, self.width - 2 * x, self.height - 2 * y)
            .unwrap_or(*self)
    }

    fn row(&self, y: usize) -> &[u8] {
        let at = y * self.stride;
        &self.luma[at..at + self.width]
    }
}

/// Width and height of the picture [`fingerprint`] is taken over.
pub const PROBE: (usize, usize) = (64, 48);

/// Color, so the fingerprint covers the conversion to [`crate::luma`] as well
/// as the hashing: a channel each, coprime enough to leave no flat field.
///
/// Arithmetic a port can restate rather than a fixture it has to ship.
#[must_use]
pub fn probe() -> Vec<u8> {
    let (width, _) = PROBE;
    let channel = |at: usize, across: usize, down: usize| {
        u8::try_from((at % width * across + at / width * down) % 251).unwrap_or(0)
    };
    (0..pixels())
        .flat_map(|at| [channel(at, 7, 11), channel(at, 13, 5), channel(at, 3, 17)])
        .collect()
}

/// Pixels the probe covers, its bytes being three of those each.
fn pixels() -> usize {
    let (width, height) = PROBE;
    width * height
}

/// One picture's [`entry`], folded to a word, naming this build's hashing.
///
/// Derived rather than written down, so a change to anything above moves it
/// with no one remembering to. What carries it and why is `docs/scryfall.md`.
#[must_use]
pub fn fingerprint() -> Hash {
    let (width, height) = PROBE;
    let levels = crate::luma::plane(&probe(), 3);
    let Some(frame) = Frame::new(&levels, width, height, width) else {
        return 0;
    };
    entry(&frame)
        .into_iter()
        .fold(0, |held, hash| (held ^ hash).wrapping_mul(MIX))
}

/// An odd multiplier, so folding the entry keeps the order it came in.
const MIX: Hash = 0x9e37_79b9_7f4a_7c15;

/// Bits differing between two hashes.
#[must_use]
pub fn distance(a: Hash, b: Hash) -> u32 {
    (a ^ b).count_ones()
}

/// One artwork's index entry: its hash at each inset the index holds.
///
/// The builder and whatever scans against it both come through here, which is
/// what [`fingerprint`] stamps a store and an index with.
#[must_use]
pub fn entry(frame: &Frame) -> [Hash; HASHES] {
    std::array::from_fn(|at| phash(&frame.inset(INSETS[at])))
}

/// Each bit says whether a pixel is brighter than the one to its right.
///
/// Gradients rather than levels, so it survives the exposure difference
/// between a scan and a photograph of the same card.
#[must_use]
pub fn dhash(frame: &Frame) -> Hash {
    let grid = resample(frame, 9, 8);

    let mut hash = 0;
    for row in grid.as_chunks::<9>().0 {
        for pair in row.windows(2) {
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
pub fn phash(frame: &Frame) -> Hash {
    let grid = resample(frame, DCT_SIDE, DCT_SIDE);
    let mut rows = [[0f32; DCT_SIDE]; DCT_SIDE];
    for (row, source) in rows.iter_mut().zip(grid.as_chunks::<DCT_SIDE>().0) {
        *row = *source;
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
    for freq in kept {
        hash = (hash << 1) | u64::from(freq > median);
    }
    hash
}

/// Which source pixels one output pixel draws from, and how much of each.
#[derive(Debug)]
struct Tap {
    first: usize,
    weights: Vec<f32>,
}

/// A triangle filter's taps along one axis.
///
/// Triangle over Lanczos: the query is a camera frame that has already been
/// resampled once, and the sharper filter only sharpens that difference. The
/// support widens with the ratio, or sampling a 626-wide crop at 32 points
/// would read 32 of its pixels and alias the rest.
fn taps(src: usize, dst: usize) -> Vec<Tap> {
    let ratio = src as f32 / dst as f32;
    let scale = ratio.max(1.0);

    (0..dst)
        .map(|at| {
            let center = (at as f32 + 0.5) * ratio - 0.5;
            let mut first = (center - scale).ceil().max(0.0) as usize;
            let last = ((center + scale).floor() as usize).min(src - 1).max(first);

            let mut weights: Vec<f32> = (first..=last)
                .map(|at| triangle((at as f32 - center) / scale))
                .collect();
            let total: f32 = weights.iter().sum();
            if total > 0.0 {
                for weight in &mut weights {
                    *weight /= total;
                }
            } else {
                // No reachable ratio puts every tap on a zero of the filter,
                // but dividing by that total would poison the row with NaN.
                first = center.round().clamp(0.0, (src - 1) as f32) as usize;
                weights = vec![1.0];
            }
            Tap { first, weights }
        })
        .collect()
}

fn triangle(at: f32) -> f32 {
    let at = at.abs();
    if at < 1.0 { 1.0 - at } else { 0.0 }
}

/// The frame as a `dst_w` by `dst_h` grid of levels, filtered on the way down.
fn resample(frame: &Frame, dst_w: usize, dst_h: usize) -> Vec<f32> {
    let across = taps(frame.width, dst_w);
    let mut wide = vec![0f32; frame.height * dst_w];
    for (y, out) in wide.chunks_mut(dst_w).enumerate() {
        let row = frame.row(y);
        for (cell, tap) in out.iter_mut().zip(&across) {
            *cell = tap
                .weights
                .iter()
                .enumerate()
                .map(|(at, weight)| f32::from(row[tap.first + at]) * weight)
                .sum();
        }
    }

    let down = taps(frame.height, dst_h);
    let mut out = vec![0f32; dst_h * dst_w];
    for (row, tap) in out.chunks_mut(dst_w).zip(&down) {
        for (x, cell) in row.iter_mut().enumerate() {
            let level: f32 = tap
                .weights
                .iter()
                .enumerate()
                .map(|(at, weight)| wide[(tap.first + at) * dst_w + x] * weight)
                .sum();
            // Back to whole levels, as a pixel would be. Normalized weights
            // sum to one only to about a part in twenty-five thousand, and
            // without this a flat field reaches the transform with a ripple
            // on it and comes out as a hash of the rounding.
            *cell = level.round().clamp(0.0, 255.0);
        }
    }
    out
}

/// Separable DCT-II, the rows then the columns.
fn dct_2d(input: &[[f32; DCT_SIDE]; DCT_SIDE]) -> [[f32; DCT_SIDE]; DCT_SIDE] {
    let basis = basis();

    let mut rows = [[0f32; DCT_SIDE]; DCT_SIDE];
    for (out, row) in rows.iter_mut().zip(input) {
        *out = dct_1d(row, &basis);
    }

    let mut out = [[0f32; DCT_SIDE]; DCT_SIDE];
    let mut column = [0f32; DCT_SIDE];
    for x in 0..DCT_SIDE {
        for (cell, row) in column.iter_mut().zip(&rows) {
            *cell = row[x];
        }
        let transformed = dct_1d(&column, &basis);
        for (row, cell) in out.iter_mut().zip(&transformed) {
            row[x] = *cell;
        }
    }
    out
}

/// `cos(pi (2n + 1) k / 2N)`, every frequency against every sample.
///
/// Once per hash rather than once per row: the same 1,024 values serve both
/// passes and all sixty-four transforms.
fn basis() -> [[f32; DCT_SIDE]; DCT_SIDE] {
    let mut out = [[0f32; DCT_SIDE]; DCT_SIDE];
    for (k, row) in out.iter_mut().enumerate() {
        for (n, cell) in row.iter_mut().enumerate() {
            let angle = std::f32::consts::PI * (2.0 * n as f32 + 1.0) * k as f32 / (2.0 * SIDE);
            *cell = libm::cosf(angle);
        }
    }
    out
}

fn dct_1d(input: &[f32; DCT_SIDE], basis: &[[f32; DCT_SIDE]; DCT_SIDE]) -> [f32; DCT_SIDE] {
    let mut out = [0f32; DCT_SIDE];
    for (cell, row) in out.iter_mut().zip(basis) {
        *cell = input.iter().zip(row).map(|(value, cos)| value * cos).sum();
    }
    out
}
