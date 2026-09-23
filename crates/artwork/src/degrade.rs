//! What a photograph does to an artwork that a scan does not.
//!
//! A stand-in for real camera frames, which is what these want replacing
//! with — the numbers they produce are an upper bound, not a field result.

// Truncating toward a pixel is what sampling a grid means, and a coordinate
// is checked against the bounds before it indexes anything.
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};

/// One way a query differs from the image the index was built from.
#[derive(Debug)]
pub struct Degradation {
    pub name: &'static str,
    pub apply: fn(&DynamicImage) -> DynamicImage,
}

/// Each on its own, then all of them together, so a failure names its cause.
pub const ALL: &[Degradation] = &[
    Degradation {
        name: "none",
        apply: |image| image.clone(),
    },
    Degradation {
        name: "crop",
        apply: |image| window(image, MISFRAME),
    },
    Degradation {
        name: "blur",
        apply: |image| image.blur(1.5),
    },
    Degradation {
        name: "dim",
        apply: |image| image.brighten(-40),
    },
    Degradation {
        name: "jpeg",
        apply: |image| recompress(image, 40),
    },
    Degradation {
        name: "rotate",
        apply: |image| rotate(image, 2.0),
    },
    Degradation {
        name: "photo",
        apply: |image| {
            let out = window(image, MISFRAME);
            let out = rotate(&out, 2.0);
            let out = out.blur(1.0).brighten(-25);
            recompress(&out, 55)
        },
    },
];

/// A framing error off each edge in turn: left, top, right, bottom.
///
/// Deliberately not one of the insets the index holds, and not the same on
/// opposite edges. A query that landed on a stored crop exactly would be
/// measuring the harness.
pub const MISFRAME: [f32; 4] = [0.04, 0.07, 0.02, 0.05];

/// Takes `inset` off every edge and resizes back. What the index holds an
/// artwork at, against the framing a scanner actually arrives with.
#[must_use]
pub fn inset(image: &DynamicImage, inset: f32) -> DynamicImage {
    window(image, [inset; 4])
}

/// Takes each edge's share off and resizes back, which is the framing error a
/// scanner makes against Scryfall's own crop of the same art.
#[must_use]
pub fn window(image: &DynamicImage, edges: [f32; 4]) -> DynamicImage {
    let (width, height) = (image.width(), image.height());
    let (left, right) = (edge(width, edges[0]), edge(width, edges[2]));
    let (top, bottom) = (edge(height, edges[1]), edge(height, edges[3]));
    if width <= left + right || height <= top + bottom {
        return image.clone();
    }
    image
        .crop_imm(left, top, width - left - right, height - top - bottom)
        .resize_exact(width, height, FilterType::Triangle)
}

fn edge(length: u32, inset: f32) -> u32 {
    let scaled = f64::from(length) * f64::from(inset);
    scaled as u32
}

/// Nearest-neighbor about the center. The hash runs over a 32-pixel grid, so
/// a better sampler would be measuring the sampler.
fn rotate(image: &DynamicImage, degrees: f32) -> DynamicImage {
    let source = image.to_rgba8();
    let (width, height) = (source.width(), source.height());
    let (cx, cy) = (f32::from(u16(width)) / 2.0, f32::from(u16(height)) / 2.0);
    let (sin, cos) = degrees.to_radians().sin_cos();

    let mut out = RgbaImage::new(width, height);
    for (x, y, pixel) in out.enumerate_pixels_mut() {
        let (dx, dy) = (f32::from(u16(x)) - cx, f32::from(u16(y)) - cy);
        let sx = dx * cos + dy * sin + cx;
        let sy = -dx * sin + dy * cos + cy;
        *pixel = if sx >= 0.0 && sy >= 0.0 {
            let (sx, sy) = (sx as u32, sy as u32);
            if sx < width && sy < height {
                *source.get_pixel(sx, sy)
            } else {
                // The corners a rotation swings in from outside the frame,
                // which a camera fills with whatever the card is lying on.
                Rgba([0, 0, 0, 255])
            }
        } else {
            Rgba([0, 0, 0, 255])
        };
    }
    DynamicImage::ImageRgba8(out)
}

fn recompress(image: &DynamicImage, quality: u8) -> DynamicImage {
    let mut bytes = Vec::new();
    let rgb = DynamicImage::ImageRgb8(image.to_rgb8());
    if rgb
        .write_with_encoder(JpegEncoder::new_with_quality(&mut bytes, quality))
        .is_err()
    {
        return image.clone();
    }
    image::load_from_memory_with_format(&bytes, ImageFormat::Jpeg).unwrap_or_else(|_| image.clone())
}

fn u16(value: u32) -> u16 {
    u16::try_from(value).unwrap_or(u16::MAX)
}
