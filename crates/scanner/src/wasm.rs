//! The C ABI the engine is reached through off-Rust.
//!
//! Built with `cargo rustc --crate-type cdylib`, and why it is shaped this
//! way is `docs/scanner.md`.

use std::alloc::{Layout, alloc, dealloc};

use crate::Frame;
use crate::detect::{self, Point, Quad};
use crate::hash::{HASHES, Hash, entry, fingerprint};
use crate::luma::level;
use crate::query;

/// Bytes as the allocator was asked for them, so a free states the same size.
///
/// A `Vec` would not: it is free to take more than it was reserved, and only
/// the size it actually took may be given back.
fn layout(bytes: usize) -> Option<Layout> {
    (bytes > 0).then(|| Layout::from_size_align(bytes, 1).ok())?
}

/// Hands back `bytes` of memory for a caller to write a plane into.
///
/// Null for nothing at all, and where the allocation fails — which on wasm32
/// means the module has reached its memory limit.
#[unsafe(no_mangle)]
pub extern "C" fn scan_alloc(bytes: usize) -> *mut u8 {
    let Some(layout) = layout(bytes) else {
        return core::ptr::null_mut();
    };
    unsafe { alloc(layout) }
}

/// Gives back what [`scan_alloc`] handed over.
///
/// # Safety
///
/// `at` came from [`scan_alloc`] and `bytes` is what it was asked for.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scan_free(at: *mut u8, bytes: usize) {
    let Some(layout) = layout(bytes) else {
        return;
    };
    if !at.is_null() {
        unsafe { dealloc(at, layout) };
    }
}

/// Words [`scan_entry`] writes, so nothing outside has to hold the number.
#[unsafe(no_mangle)]
pub extern "C" fn scan_hashes() -> usize {
    HASHES
}

/// This build's [`fingerprint`], which an index has to name to be read.
#[unsafe(no_mangle)]
pub extern "C" fn scan_fingerprint() -> Hash {
    fingerprint()
}

/// Writes one level per pixel of the `step`-byte pixels at `at`, to `out`.
///
/// Answers 0, or -1 for a step narrower than a color.
///
/// # Safety
///
/// `at` covers `pixels * step` bytes and `out` covers `pixels`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scan_luma(at: *const u8, pixels: usize, step: usize, out: *mut u8) -> i32 {
    if at.is_null() || out.is_null() || step < 3 {
        return -1;
    }
    let Some(bytes) = pixels.checked_mul(step) else {
        return -1;
    };
    let color = unsafe { core::slice::from_raw_parts(at, bytes) };
    let levels = unsafe { core::slice::from_raw_parts_mut(out, pixels) };
    for (cell, pixel) in levels.iter_mut().zip(color.chunks_exact(step)) {
        *cell = level(pixel[0], pixel[1], pixel[2]);
    }
    0
}

/// Floats a quadrilateral is passed as, a corner being two of them.
const CORNERS: usize = 8;

/// A caller asked for a frame it did not describe.
const REFUSED: i32 = -1;

/// The call read the frame and wrote nothing: no card in it, or no room.
const NOTHING: i32 = 1;

/// The frame a caller's numbers describe, or `None` where they describe none.
///
/// # Safety
///
/// `at` covers `(height - 1) * stride + width` bytes.
unsafe fn frame<'a>(
    at: *const u8,
    width: usize,
    height: usize,
    stride: usize,
) -> Option<Frame<'a>> {
    if at.is_null() || height == 0 {
        return None;
    }
    let span = height
        .saturating_sub(1)
        .checked_mul(stride)?
        .checked_add(width)?;
    let luma = unsafe { core::slice::from_raw_parts(at, span) };
    Frame::new(luma, width, height, stride)
}

/// Four corners as a caller passes them, or `None` for a degenerate one.
///
/// # Safety
///
/// `at` covers [`CORNERS`] floats.
unsafe fn corners(at: *const f32) -> Option<Quad> {
    if at.is_null() {
        return None;
    }
    let held = unsafe { core::slice::from_raw_parts(at, CORNERS) };
    Quad::new(std::array::from_fn(|corner| Point {
        x: held[corner * 2],
        y: held[corner * 2 + 1],
    }))
}

/// Writes four corners where a caller wants them, zeroing for none.
///
/// # Safety
///
/// `out` is null or covers [`CORNERS`] floats.
unsafe fn wrote(quad: Option<&Quad>, out: *mut f32) {
    if out.is_null() {
        return;
    }
    let held = unsafe { core::slice::from_raw_parts_mut(out, CORNERS) };
    held.fill(0.0);
    for (corner, point) in quad.iter().flat_map(|quad| quad.corners).enumerate() {
        held[corner * 2] = point.x;
        held[corner * 2 + 1] = point.y;
    }
}

/// Hashes the plane at `at`, writing [`scan_hashes`] words to `out`.
///
/// Answers 0, or -1 for a frame the buffer does not hold.
///
/// # Safety
///
/// `at` covers `(height - 1) * stride + width` bytes and `out` covers
/// [`scan_hashes`] words.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scan_entry(
    at: *const u8,
    width: usize,
    height: usize,
    stride: usize,
    out: *mut Hash,
) -> i32 {
    let Some(frame) = (unsafe { frame(at, width, height, stride) }) else {
        return REFUSED;
    };
    if out.is_null() {
        return REFUSED;
    }
    let hashes = entry(&frame);
    unsafe { core::ptr::copy_nonoverlapping(hashes.as_ptr(), out, HASHES) };
    0
}

/// Finds the card in the plane at `at`, writing [`CORNERS`] floats to `out`.
///
/// They wind clockwise from one end of a short side, in the plane's own
/// pixels. Answers 0, 1 where nothing in the frame is shaped like a card, or
/// -1 for a frame the buffer does not hold.
///
/// # Safety
///
/// `at` covers `(height - 1) * stride + width` bytes and `out` covers
/// [`CORNERS`] floats.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scan_detect(
    at: *const u8,
    width: usize,
    height: usize,
    stride: usize,
    out: *mut f32,
) -> i32 {
    let Some(frame) = (unsafe { frame(at, width, height, stride) }) else {
        return REFUSED;
    };
    if out.is_null() {
        return REFUSED;
    }
    let Some(found) = detect::card(&frame) else {
        unsafe { wrote(None, out) };
        return NOTHING;
    };
    unsafe { wrote(Some(&found), out) };
    0
}

/// Reads the card at `quad` back as a rectangle, writing its levels to `out`.
///
/// `size` takes how big it comes back, and a `room` short of that answers
/// [`NOTHING`] having written no levels: ask once for the size, then again
/// with the room. Otherwise 0, or -1 for a frame the buffer does not hold or
/// corners that enclose nothing, which leave `size` zero.
///
/// # Safety
///
/// `at` covers `(height - 1) * stride + width` bytes, `quad` covers
/// [`CORNERS`] floats, `size` covers two `usize`, and `out` covers `room`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scan_rectify(
    at: *const u8,
    width: usize,
    height: usize,
    stride: usize,
    quad: *const f32,
    out: *mut u8,
    room: usize,
    size: *mut usize,
) -> i32 {
    if size.is_null() {
        return REFUSED;
    }
    // Before anything that can refuse: a caller reading the size back after
    // one would otherwise take its next allocation from what the heap held.
    unsafe {
        size.write(0);
        size.add(1).write(0);
    }

    let Some(frame) = (unsafe { frame(at, width, height, stride) }) else {
        return REFUSED;
    };
    let Some(quad) = (unsafe { corners(quad) }) else {
        return REFUSED;
    };

    let (wide, tall) = detect::size(&quad);
    unsafe {
        size.write(wide);
        size.add(1).write(tall);
    }
    let Some(whole) = wide.checked_mul(tall) else {
        return REFUSED;
    };
    if room < whole {
        return NOTHING;
    }
    if out.is_null() {
        return REFUSED;
    }

    let Some(card) = detect::rectify(&frame, &quad) else {
        return REFUSED;
    };
    let Some(read) = card.frame() else {
        return REFUSED;
    };

    // No padding: a caller asked for exactly this many.
    let levels = unsafe { core::slice::from_raw_parts_mut(out, whole) };
    for (y, row) in levels.chunks_exact_mut(wide).enumerate() {
        for (x, held) in row.iter_mut().enumerate() {
            *held = read.at(x, y).unwrap_or(0);
        }
    }
    0
}

/// Words [`scan_query`] may write, so a caller can make the room once.
#[unsafe(no_mangle)]
pub extern "C" fn scan_query_words() -> usize {
    query::MOST
}

/// Everything the plane at `at` asks the index, written to `out`.
///
/// Answers how many words it wrote, or -1 for a frame the buffer does not
/// hold. `quad` may be null; otherwise it takes the card the hashes were cut
/// from, zeroed where the framing was guessed at instead.
///
/// # Safety
///
/// `at` covers `(height - 1) * stride + width` bytes, `out` covers
/// [`scan_query_words`] words, and `quad` is null or covers [`CORNERS`]
/// floats.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn scan_query(
    at: *const u8,
    width: usize,
    height: usize,
    stride: usize,
    out: *mut Hash,
    quad: *mut f32,
) -> i32 {
    let Some(frame) = (unsafe { frame(at, width, height, stride) }) else {
        return REFUSED;
    };
    if out.is_null() {
        return REFUSED;
    }
    let asked = query::query(&frame);
    // What `scan_query_words` promised, and so what the copy below trusts a
    // caller to have made room for.
    if asked.hashes.len() > query::MOST {
        return REFUSED;
    }
    let Ok(words) = i32::try_from(asked.hashes.len()) else {
        return REFUSED;
    };
    unsafe {
        core::ptr::copy_nonoverlapping(asked.hashes.as_ptr(), out, asked.hashes.len());
        wrote(asked.found.as_ref(), quad);
    }
    words
}
