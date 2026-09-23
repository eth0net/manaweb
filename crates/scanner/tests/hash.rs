//! What the hashes do to an image that has been through something.
//!
//! Synthetic rather than real artwork: these pin the properties the index
//! rests on, and what a hash retrieves out of fifty thousand real ones is a
//! measurement rather than an assertion — `just measure-art`.

use manaweb_scanner::hash::{Frame, dhash, distance, entry, phash};

const WIDTH: usize = 240;
const HEIGHT: usize = 170;

/// Structure at several scales, because a hash of a flat field says nothing.
/// `seed` moves the pattern without changing its character.
fn artwork(seed: u32) -> Vec<u8> {
    let mut out = vec![0u8; WIDTH * HEIGHT];
    for (at, level) in out.iter_mut().enumerate() {
        let x = u32::try_from(at % WIDTH).unwrap().wrapping_mul(seed | 1);
        let y = u32::try_from(at / WIDTH).unwrap().wrapping_add(seed);
        let coarse = (x / 37 + y / 23) % 5;
        let fine = (x * 7 + y * 13 + seed) % 97;
        *level = u8::try_from((coarse * 40 + fine / 3) % 256).unwrap_or(0);
    }
    out
}

fn frame(luma: &[u8]) -> Frame<'_> {
    Frame::new(luma, WIDTH, HEIGHT, WIDTH).expect("a frame")
}

/// A box blur, which is the lens these have no other way to reach.
fn blur(luma: &[u8]) -> Vec<u8> {
    let mut out = luma.to_vec();
    for _ in 0..3 {
        let source = out.clone();
        for y in 1..HEIGHT - 1 {
            for x in 1..WIDTH - 1 {
                let mut sum = 0u32;
                for dy in 0..3 {
                    for dx in 0..3 {
                        sum += u32::from(source[(y + dy - 1) * WIDTH + x + dx - 1]);
                    }
                }
                out[y * WIDTH + x] = u8::try_from(sum / 9).unwrap_or(u8::MAX);
            }
        }
    }
    out
}

#[test]
fn an_artwork_hashes_to_itself() {
    let (one, two) = (artwork(1), artwork(1));
    assert_eq!(dhash(&frame(&one)), dhash(&frame(&two)));
    assert_eq!(phash(&frame(&one)), phash(&frame(&two)));
}

#[test]
fn two_artworks_are_far_apart() {
    let (a, b) = (artwork(1), artwork(9));
    assert!(distance(dhash(&frame(&a)), dhash(&frame(&b))) > 16);
    assert!(distance(phash(&frame(&a)), phash(&frame(&b))) > 16);
}

/// The lighting and the lens are what a hash is chosen to survive.
#[test]
fn a_blurred_artwork_stays_near_its_own_hash() {
    let image = artwork(3);
    let soft = blur(&image);
    assert!(distance(dhash(&frame(&image)), dhash(&frame(&soft))) <= 4);
    assert!(distance(phash(&frame(&image)), phash(&frame(&soft))) <= 4);
}

/// Camera rows carry padding past the pixels. Taking the stride for the width
/// shears the picture, and nothing downstream can tell.
#[test]
fn the_padding_between_rows_reaches_no_hash() {
    let tight = artwork(3);
    let stride = WIDTH + 37;

    let mut padded = vec![0xA5u8; stride * HEIGHT];
    for (row, source) in padded.chunks_mut(stride).zip(tight.chunks(WIDTH)) {
        row[..WIDTH].copy_from_slice(source);
    }
    let padded = Frame::new(&padded, WIDTH, HEIGHT, stride).expect("a frame");

    assert_eq!(phash(&padded), phash(&frame(&tight)));
    assert_eq!(dhash(&padded), dhash(&frame(&tight)));
}

/// The measured finding this crate exists to act on: framing is the one
/// degradation a global hash does not shrug off.
#[test]
fn a_crop_moves_a_hash_further_than_a_blur_does() {
    let image = artwork(5);
    let soft = blur(&image);
    let framed = misframed(&image);

    let whole = phash(&frame(&image));
    assert!(distance(whole, phash(&framed)) > distance(whole, phash(&frame(&soft))));
}

/// Which is why the index holds an artwork at several insets rather than only
/// at Scryfall's own framing. The query is off-center and lands on none of
/// them, or this would be measuring two calls agreeing.
#[test]
fn indexing_the_crop_too_brings_it_back() {
    let image = artwork(7);
    let asked = phash(&misframed(&image));

    let alone = distance(phash(&frame(&image)), asked);
    let held = entry(&frame(&image))
        .into_iter()
        .map(|held| distance(held, asked))
        .min()
        .unwrap();

    assert!(held < alone, "held {held} against {alone}");
}

/// A framing error off each edge in turn, none of them an inset the index
/// holds and no two the same. A query that landed on a stored crop exactly
/// would be measuring the harness.
fn misframed(luma: &[u8]) -> Frame<'_> {
    frame(luma)
        .window(
            WIDTH * 4 / 100,
            HEIGHT * 7 / 100,
            WIDTH * 94 / 100,
            HEIGHT * 88 / 100,
        )
        .expect("a window")
}

#[test]
fn a_frame_refuses_what_it_cannot_read() {
    let luma = artwork(1);
    assert!(Frame::new(&luma, WIDTH, HEIGHT, WIDTH - 1).is_none());
    assert!(Frame::new(&luma, WIDTH, HEIGHT + 1, WIDTH).is_none());
    assert!(Frame::new(&luma, 0, HEIGHT, WIDTH).is_none());
    assert!(frame(&luma).window(1, 0, WIDTH, HEIGHT).is_none());
}

/// A frame of one level is the same frame however many pixels it arrived as,
/// so it has to hash the same. Without whole levels out of the resampler the
/// normalized weights leave a ripple on it, and each size comes out as a hash
/// of its own rounding.
#[test]
fn a_flat_frame_hashes_the_same_at_any_size() {
    let flat = |width: usize, height: usize, level: u8| {
        let luma = vec![level; width * height];
        let frame = Frame::new(&luma, width, height, width).expect("a frame");
        (phash(&frame), dhash(&frame))
    };

    assert_eq!(flat(626, 457, 128), flat(640, 480, 128));
    assert_eq!(flat(626, 457, 200), flat(97, 61, 200));

    // No pixel is brighter than the one beside it, at any level.
    assert_eq!(flat(626, 457, 200).1, 0);
    // And an unlit camera is the artwork the index has no image for.
    assert_eq!(flat(626, 457, 0), (0, 0));
}
