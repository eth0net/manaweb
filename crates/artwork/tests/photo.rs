//! Reading a photograph the way the camera was held.

use std::path::Path;

use manaweb_artwork::photo;

/// Landscape pixels tagged as a portrait shot, which is what a phone writes.
#[test]
fn a_photograph_arrives_the_way_up_it_was_taken() {
    let path = Path::new("tests/photos/turned.jpg");
    let held = image::open(path).expect("decodes");
    assert_eq!((held.width(), held.height()), (40, 20), "the stored rows");

    let read = photo::read(path).expect("reads");
    assert_eq!((read.width(), read.height()), (20, 40), "turned upright");

    // A gradient down it, so the turn moved the pixels and not only the
    // width and the height.
    let level = |x, y| read.to_luma8().get_pixel(x, y).0[0];
    assert!(
        level(10, 2) < level(10, 37),
        "{} {}",
        level(10, 2),
        level(10, 37)
    );
}
