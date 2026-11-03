use std::collections::BTreeMap;

use serde::Deserialize;
use uuid::Uuid;

use crate::Contents;

/// One sealed product: a pack, a box, a precon, a bundle.
///
/// Hangs off the set rather than the card, so the whole catalog is one small
/// table — `docs/products.md` for what it costs and what it reaches.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub uuid: Uuid,
    pub name: String,
    pub set_code: String,
    /// `booster_box`, `deck`, `bundle` and a dozen more, plus `unknown`. A
    /// string for the same reason Scryfall's taxonomies are.
    pub category: Option<String>,
    pub subtype: Option<String>,
    pub release_date: Option<String>,
    /// How many cards MTGJSON believes are in it, which for a booster is the
    /// pack size rather than anything derived from [`Self::contents`].
    pub card_count: Option<u32>,
    /// How many of the thing the name describes — 36 packs, 6 boxes.
    pub product_size: Option<u32>,
    #[serde(deserialize_with = "crate::contents::column")]
    pub contents: Contents,
    /// Everyone else's product ids, `mcmId` among them — which is
    /// Cardmarket's `idProduct` for the *product*, as `cardmarket_id` is for
    /// a card.
    #[serde(deserialize_with = "crate::contents::column")]
    pub identifiers: BTreeMap<String, String>,
}
