//! What each migration checksums to, so that editing one is a decision.
//!
//! sqlx records a checksum of every file and refuses a database whose record
//! disagrees, over the whole file rather than the statements — so retargeting
//! a doc pointer in a comment locks out every cache that has already run it.
//! `d65aea8` did that to `0003` and nothing said so until a database would
//! not open.
//!
//! Editing one is still allowed. What this asks is that the databases which
//! ran the old text are repaired in the same change, rather than found later
//! by whoever opens one.
const SHIPPED: [(i64, &str); 4] = [
    (
        1,
        "bbd28948ec1eed12ffb5d2e67fbe9845d2526bba52113c9b62cec6ed56b5de2234e6aa48849cf7e140dc6fda0c405448",
    ),
    (
        2,
        "b2e4b76873551e608a97743d2dfc9875aa24dfb0463bdad1b630b6a9d9d44a2fe9a58229603c58512e2c44da6603812d",
    ),
    (
        3,
        "e1af3f5b84c4c2c77632b7372f6cdc9d43212f7b98a3d691d63e1c9aa1107dd9cdd39136030f50d1de3b23faddbb3ac8",
    ),
    (
        4,
        "9fae5c4e237266bca8b279a8d21d0b4f3add4634f49511dd6018cde064c730b89de7d3a40ef39688bc107aca93599897",
    ),
];

#[test]
fn a_migration_changing_is_a_decision_rather_than_an_accident() {
    let held: Vec<(i64, String)> = sqlx::migrate!("./migrations")
        .migrations
        .iter()
        .map(|one| (one.version, hex(&one.checksum)))
        .collect();

    let shipped: Vec<(i64, String)> = SHIPPED
        .iter()
        .map(|(version, sum)| (*version, (*sum).to_owned()))
        .collect();

    assert_eq!(
        held, shipped,
        "a migration changed, comments included. Repair the databases that ran \
         the old text in this same change, then update the line here. A new \
         migration is a new line."
    );
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, byte| {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
        out
    })
}
