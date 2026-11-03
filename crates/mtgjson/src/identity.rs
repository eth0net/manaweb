use serde::Deserialize;
use uuid::Uuid;

/// The two columns of `cardIdentifiers` that matter here, out of twenty-five.
///
/// The other twenty-three are other marketplaces' ids and are read past rather
/// than fetched separately — the table only exists whole.
///
/// `tokenIdentifiers` has the same two columns, and a uuid `cardIdentifiers`
/// misses is a token every time it was checked.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub uuid: Uuid,
    /// The printing in the card cache. Several uuids share one, because a
    /// part is what gets a uuid rather than a printing: every multi-part
    /// layout repeats this id, up to five times for a five-part split.
    pub scryfall_id: Uuid,
}
