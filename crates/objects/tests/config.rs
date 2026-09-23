//! What a bucket's settings say about themselves.

use manaweb_objects::Config;

// The type is public and carries a bucket key in cleartext, so one `{:?}`
// added while looking at something else must not put it in a log.
#[test]
fn a_config_does_not_print_its_secret() {
    let printed = format!(
        "{:?}",
        Config {
            endpoint: "http://bucket".to_owned(),
            bucket: "manaweb-static".to_owned(),
            key_id: "key".to_owned(),
            secret: "sekrit".to_owned(),
            region: "auto".to_owned(),
        }
    );

    assert!(!printed.contains("sekrit"), "{printed}");
    assert!(printed.contains("key"), "the rest of it still prints");
}
