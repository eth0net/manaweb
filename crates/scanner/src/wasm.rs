//! The C ABI the engine is reached through off-Rust.
//!
//! Built with `cargo rustc --crate-type cdylib`, and why it is shaped this
//! way is `docs/roadmap.md`.

use std::alloc::{Layout, alloc, dealloc};

use crate::Frame;
use crate::hash::{HASHES, Hash, entry, fingerprint};

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
    if at.is_null() || out.is_null() {
        return -1;
    }
    let Some(span) = height
        .saturating_sub(1)
        .checked_mul(stride)
        .and_then(|rows| rows.checked_add(width))
    else {
        return -1;
    };
    let luma = unsafe { core::slice::from_raw_parts(at, span) };
    let Some(frame) = Frame::new(luma, width, height, stride) else {
        return -1;
    };
    let hashes = entry(&frame);
    unsafe { core::ptr::copy_nonoverlapping(hashes.as_ptr(), out, HASHES) };
    0
}
