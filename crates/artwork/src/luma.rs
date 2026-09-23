//! Handing a decoded image to the engine, which reads luma and a stride.

use image::DynamicImage;
use manaweb_scanner::Frame;

/// A decoded image as the engine reads it.
///
/// Owns the plane, a [`Frame`] borrowing one. Nothing pads a row here, so the
/// stride is the width, where a camera's would not be.
#[derive(Debug)]
pub struct Plane {
    luma: Vec<u8>,
    width: usize,
    height: usize,
}

impl Plane {
    #[must_use]
    pub fn new(image: &DynamicImage) -> Self {
        let gray = image.to_luma8();
        let (width, height) = (gray.width(), gray.height());
        Self {
            luma: gray.into_raw(),
            width: width as usize,
            height: height as usize,
        }
    }

    /// `None` for an image with no pixels.
    #[must_use]
    pub fn frame(&self) -> Option<Frame<'_>> {
        Frame::new(&self.luma, self.width, self.height, self.width)
    }
}
