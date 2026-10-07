//! What each migration checksums to, so that editing one is a decision.
//!
//! sqlx records a checksum of every file and refuses a database whose record
//! disagrees, over the whole file rather than the statements — so retargeting
//! a doc pointer in a comment locks out every cache that has already run it.
//! `d65aea8` did that to `0003` and nothing said so until a database would
//! not open.

const SHIPPED: [(i64, &str, &str); 5] = [
    (
        1,
        "0001_card_cache.sql",
        "bbd28948ec1eed12ffb5d2e67fbe9845d2526bba52113c9b62cec6ed56b5de2234e6aa48849cf7e140dc6fda0c405448",
    ),
    (
        2,
        "0002_export_order.sql",
        "b2e4b76873551e608a97743d2dfc9875aa24dfb0463bdad1b630b6a9d9d44a2fe9a58229603c58512e2c44da6603812d",
    ),
    (
        3,
        "0003_illustration.sql",
        "e1af3f5b84c4c2c77632b7372f6cdc9d43212f7b98a3d691d63e1c9aa1107dd9cdd39136030f50d1de3b23faddbb3ac8",
    ),
    (
        4,
        "0004_sync_schema.sql",
        "9fae5c4e237266bca8b279a8d21d0b4f3add4634f49511dd6018cde064c730b89de7d3a40ef39688bc107aca93599897",
    ),
    (
        5,
        "0005_reversible_order.sql",
        "195ddbdd24bc64b830a131f05d2078f60ba9477003e92ba60b5fa662cc3164b4294f34d93f471de9e7baacc9b31819af",
    ),
];

/// The directory as it is now, read rather than compiled in.
///
/// `sqlx::migrate!` expands to one `include_str!` per file that existed when
/// the crate was last built, so cargo sees no reason to rebuild when a new
/// one appears — and a test asking only what the macro holds would pass
/// without ever seeing it. This is the half that catches an addition.
fn on_disk() -> Vec<String> {
    let at = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut held: Vec<String> = std::fs::read_dir(at)
        .expect("the migrations directory")
        .map(|entry| entry.expect("a directory entry").file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| {
            std::path::Path::new(name)
                .extension()
                .is_some_and(|of| of == "sql")
        })
        .collect();
    held.sort();
    held
}

#[test]
fn every_migration_on_disk_is_one_that_shipped() {
    let named: Vec<String> = SHIPPED
        .iter()
        .map(|(version, _, _)| format!("{version:04}"))
        .collect();
    let found: Vec<String> = on_disk()
        .iter()
        .map(|name| name.split('_').next().unwrap_or_default().to_owned())
        .collect();

    assert_eq!(
        found, named,
        "a migration was added or taken away. A new one is a new line here, \
         and its checksum comes from running this test."
    );
}

#[test]
fn a_migration_changing_is_a_decision_rather_than_an_accident() {
    let held: Vec<(i64, String)> = sqlx::migrate!("./migrations")
        .migrations
        .iter()
        .map(|one| (one.version, hex(&one.checksum)))
        .collect();

    let shipped: Vec<(i64, String)> = SHIPPED
        .iter()
        .map(|(version, _, sum)| (*version, (*sum).to_owned()))
        .collect();

    assert_eq!(
        held, shipped,
        "a migration changed, comments included. Repair the databases that ran \
         the old text in the same change, then update the line here."
    );
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, byte| {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
        out
    })
}
