use manaweb_core::scan::{HASHES, Store, uuid};

/// Bytes an entry takes: the key, then its hashes.
const ENTRY: usize = 16 + HASHES * size_of::<u64>();

const ONE: &str = "366db481-4e0f-4a85-9e12-1a1a6e1f6e6f";
const TWO: &str = "a1b2c3d4-0000-4000-8000-00000000000f";

fn id(text: &str) -> [u8; 16] {
    uuid(text).expect("a uuid")
}

fn hashes(seed: u64) -> [u64; HASHES] {
    std::array::from_fn(|at| seed.wrapping_mul(at as u64 + 1))
}

#[test]
fn a_store_reads_back_what_it_wrote() {
    let mut store = Store::new();
    store.insert(id(ONE), hashes(7));
    store.insert(id(TWO), hashes(11));

    let read = Store::read(&store.write()).expect("a store");
    assert_eq!(read.len(), 2);
    assert_eq!(read.get(&id(ONE)), Some(hashes(7)));
    assert_eq!(read.get(&id(TWO)), Some(hashes(11)));
}

// An upload compares what it holds against what it has, so a store that
// hashed the same artworks has to be the same file.
#[test]
fn the_order_artworks_arrive_in_does_not_reach_the_file() {
    let mut one = Store::new();
    one.insert(id(ONE), hashes(7));
    one.insert(id(TWO), hashes(11));

    let mut two = Store::new();
    two.insert(id(TWO), hashes(11));
    two.insert(id(ONE), hashes(7));

    assert_eq!(one.write(), two.write());
}

#[test]
fn an_artwork_nothing_hashed_is_absent_rather_than_zero() {
    let store = Store::read(&Store::new().write()).expect("a store");
    assert!(store.is_empty());
    assert_eq!(store.get(&id(ONE)), None);
}

#[test]
fn something_that_is_not_a_store_is_refused() {
    assert!(Store::read(b"").is_err());
    assert!(Store::read(b"not a hash store at all").is_err());
}

#[test]
fn a_store_cut_off_part_way_is_refused() {
    let mut store = Store::new();
    store.insert(id(ONE), hashes(7));
    let bytes = store.write();

    assert!(Store::read(&bytes[..bytes.len() - 1]).is_err());
}

#[test]
fn a_uuid_reads_with_or_without_its_hyphens() {
    assert_eq!(uuid(ONE), uuid(&ONE.replace('-', "")));
    assert_eq!(uuid(ONE), uuid(&ONE.to_uppercase()));
}

#[test]
fn what_is_not_a_uuid_is_no_key() {
    assert_eq!(uuid(""), None);
    assert_eq!(uuid(&ONE[..8]), None);
    assert_eq!(uuid(&format!("{ONE}0")), None);
    assert_eq!(uuid(&ONE.replace('3', "z")), None);
}

// `write` puts them in order, so anything else was not written by this and
// would quietly hold fewer artworks than its bytes claim.
#[test]
fn entries_out_of_order_are_refused() {
    let mut store = Store::new();
    store.insert(id(ONE), hashes(7));
    store.insert(id(TWO), hashes(11));
    let bytes = store.write();

    let header = bytes.len() - 2 * ENTRY;
    let mut swapped = bytes[..header].to_vec();
    swapped.extend_from_slice(&bytes[header + ENTRY..]);
    swapped.extend_from_slice(&bytes[header..header + ENTRY]);

    assert_eq!(swapped.len(), bytes.len());
    assert!(Store::read(&swapped).is_err());
}

#[test]
fn one_artwork_twice_is_refused() {
    let mut store = Store::new();
    store.insert(id(ONE), hashes(7));
    let bytes = store.write();

    let mut twice = bytes.clone();
    twice.extend_from_slice(&bytes[bytes.len() - ENTRY..]);

    assert!(Store::read(&twice).is_err());
}

// So an upload can compare a store it read against one it built.
#[test]
fn reading_a_store_and_writing_it_back_is_the_same_file() {
    let mut store = Store::new();
    store.insert(id(ONE), hashes(7));
    store.insert(id(TWO), hashes(11));
    let bytes = store.write();

    assert_eq!(Store::read(&bytes).expect("a store").write(), bytes);
}
