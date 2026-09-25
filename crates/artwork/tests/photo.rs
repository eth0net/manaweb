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

/// English unless the name says otherwise, and a collector number with
/// hyphens of its own either way.
#[test]
fn a_name_says_what_it_has_to_and_no_more() {
    let read = |name| photo::Label::read(name).expect(name);
    let told = |name| {
        let held = read(name);
        (held.set, held.number, held.lang, held.condition)
    };

    assert_eq!(
        told("fin-211__control-foil.jpg"),
        (
            "fin".into(),
            "211".into(),
            "en".into(),
            "control-foil".into()
        )
    );
    assert_eq!(
        told("iko-386-ja__control.jpg"),
        ("iko".into(), "386".into(), "ja".into(), "control".into())
    );
    assert_eq!(
        told("plst-XLN-217__control.jpg"),
        (
            "plst".into(),
            "XLN-217".into(),
            "en".into(),
            "control".into()
        )
    );
    assert_eq!(read("tfin-18__control.jpg").name(), "tfin-18__control.jpg");
    assert_eq!(
        read("iko-386-ja__control.jpg").name(),
        "iko-386-ja__control.jpg"
    );
    assert!(photo::Label::read("nothing-in-particular.jpg").is_none());
}
