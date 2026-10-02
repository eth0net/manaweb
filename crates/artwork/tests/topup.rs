//! What a top-up run would ask for, and what it makes of an image.
//!
//! The fetching itself wants Scryfall, so what is held here is the choosing:
//! a run that asked for an artwork the store already holds would spend the
//! whole cap re-pulling images for hashes nobody needed.

use image::ImageEncoder as _;
use manaweb_artwork::Artwork;
use manaweb_artwork::topup::{Filled, hashes, missing, spent};
use manaweb_scanner::{Store, store};

/// Two hex digits per byte, so a counted id is a real one.
fn artwork(at: u8) -> Artwork {
    Artwork {
        id: format!("{:08x}-0000-4000-8000-000000000000", u32::from(at)),
        print: format!("{:08x}-1111-4000-8000-000000000000", u32::from(at)),
        back: false,
    }
}

fn held(at: u8) -> Store {
    let mut store = Store::new();
    let id = store::uuid(&artwork(at).id).expect("a uuid");
    store.insert(id, [1, 2, 3, 4]);
    store
}

#[test]
fn an_artwork_the_store_holds_is_not_asked_for_again() {
    let wanted = missing(vec![artwork(1), artwork(2), artwork(3)], &held(2));

    assert_eq!(
        wanted.iter().map(|one| one.id.clone()).collect::<Vec<_>>(),
        vec![artwork(1).id, artwork(3).id],
    );
}

#[test]
fn an_empty_store_wants_everything_the_cache_names() {
    let all = vec![artwork(1), artwork(2)];
    assert_eq!(missing(all.clone(), &Store::new()).len(), all.len());
}

/// An id no key could be made from is one nothing can ever retrieve, so it is
/// left out rather than pulled every week for a hash with nowhere to go.
#[test]
fn an_id_that_is_not_a_uuid_is_not_asked_for() {
    let mut odd = artwork(1);
    odd.id = "not an illustration id".into();

    assert!(missing(vec![odd], &Store::new()).is_empty());
}

#[test]
fn the_order_the_cache_gave_is_the_order_a_run_takes_them() {
    let all = vec![artwork(3), artwork(1), artwork(2)];
    let wanted = missing(all, &Store::new());

    assert_eq!(
        wanted.iter().map(|one| one.id.clone()).collect::<Vec<_>>(),
        vec![artwork(3).id, artwork(1).id, artwork(2).id],
    );
}

#[test]
fn an_image_that_will_not_decode_yields_no_hashes() {
    assert!(hashes(b"not an image").is_none());
    assert!(hashes(&[]).is_none());
}

/// The same four hashes a built store holds, so a topped-up artwork and a
/// pulled one are the same row.
#[test]
fn an_image_hashes_to_what_the_builder_would_have_written() {
    let mut png = Vec::new();
    {
        let out = image::codecs::png::PngEncoder::new(&mut png);
        let wide = 64u32;
        let tall = 48u32;
        let mut levels = Vec::with_capacity((wide * tall) as usize);
        for down in 0..tall {
            for across in 0..wide {
                levels.push(u8::try_from((across * 3 + down * 5) % 251).unwrap_or(0));
            }
        }
        out.write_image(&levels, wide, tall, image::ExtendedColorType::L8)
            .expect("the image encodes");
    }

    let found = hashes(&png).expect("an image that decodes");
    assert_eq!(found.len(), manaweb_scanner::hash::HASHES);
    assert!(found.iter().any(|hash| *hash != 0), "{found:?}");
}

/// A cap on what a run asks for, not on what it brings back.
#[test]
fn a_run_of_failures_still_spends_the_cap() {
    let failing = Filled {
        added: 0,
        failed: 5,
        waiting: 0,
    };
    assert!(spent(&failing, 5), "{failing:?}");

    let landing = Filled {
        added: 4,
        failed: 0,
        waiting: 0,
    };
    assert!(!spent(&landing, 5), "{landing:?}");
    assert!(spent(
        &Filled {
            added: 5,
            ..landing
        },
        5
    ));
}
