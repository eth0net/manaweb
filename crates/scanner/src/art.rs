//! Where the artwork sits on a card, and cutting a frame down to it.
//!
//! What each box was measured from, and why a shape is not asked to pick one,
//! is `docs/scanner.md`.

// A box is fractions of a frame and a frame is pixels, so the casts here are
// that crossing.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use crate::hash::Frame;

/// A rectangle of something, as fractions of its width and height.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

/// Where the artwork sits on a card, one shape of card at a time.
///
/// Measured by `just artbox` rather than taken from a diagram. Which shape
/// a photograph is of is not known while it is being read, so every one of
/// these is asked; a shape not listed shares one of them to within an inset
/// the index already holds an artwork at.
pub const BOXES: [Rect; 4] = [
    // The 1993 and 1997 frames, which are narrower and sit higher.
    Rect {
        left: 0.123,
        top: 0.103,
        right: 0.881,
        bottom: 0.541,
    },
    // Modern, borderless, older and a planeswalker between them.
    Rect {
        left: 0.082,
        top: 0.118,
        right: 0.920,
        bottom: 0.556,
    },
    // Full-art, which reaches half as far down again.
    Rect {
        left: 0.082,
        top: 0.118,
        right: 0.920,
        bottom: 0.835,
    },
    // A token, wider and taller than either.
    Rect {
        left: 0.041,
        top: 0.118,
        right: 0.959,
        bottom: 0.666,
    },
];

impl Rect {
    /// This rectangle of a frame, or `None` where it lands outside one.
    ///
    /// Shares the frame's pixels rather than copying them.
    #[must_use]
    pub fn of<'a>(&self, frame: &Frame<'a>) -> Option<Frame<'a>> {
        let across = |at: f32, of: usize| (at.clamp(0.0, 1.0) * of as f32) as usize;
        let (x, y) = (
            across(self.left, frame.width()),
            across(self.top, frame.height()),
        );
        let right = across(self.right, frame.width());
        let bottom = across(self.bottom, frame.height());
        frame.window(x, y, right.saturating_sub(x), bottom.saturating_sub(y))
    }
}
