use serde::Deserialize;
use uuid::Uuid;

/// One decklist, as a precon ships it.
///
/// Where nearly every card entry this subject reaches actually lives, by two
/// orders of magnitude — `docs/products.md` counts them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    /// The set the decklist is published under, which is not always where its
    /// cards were printed — see [`Self::source_set_codes`].
    pub set_code: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub release_date: Option<String>,
    /// Wizards' own decklist announcement, where there is one.
    pub source: Option<String>,
    /// The products that ship this list, which is the join read the other way
    /// round from a product's `deck` contents.
    #[serde(deserialize_with = "crate::contents::column")]
    pub sealed_product_uuids: Vec<Uuid>,
    #[serde(deserialize_with = "crate::contents::column")]
    pub source_set_codes: Vec<String>,

    #[serde(deserialize_with = "crate::contents::column")]
    pub main_board: Vec<Board>,
    #[serde(deserialize_with = "crate::contents::column")]
    pub side_board: Vec<Board>,
    #[serde(deserialize_with = "crate::contents::column")]
    pub commander: Vec<Board>,
    /// The face on the box, which is a commander already in [`Self::commander`]
    /// rather than an extra card.
    #[serde(deserialize_with = "crate::contents::column")]
    pub display_commander: Vec<Board>,
    /// Keyed against `tokenIdentifiers`, not `cardIdentifiers`.
    #[serde(deserialize_with = "crate::contents::column")]
    pub tokens: Vec<Board>,
    #[serde(deserialize_with = "crate::contents::column")]
    pub planes: Vec<Board>,
    #[serde(deserialize_with = "crate::contents::column")]
    pub schemes: Vec<Board>,
}

/// One entry on a board. Keyed by MTGJSON uuid and nothing else, which is why
/// reading a decklist at all means carrying the identifier map.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub uuid: Uuid,
    pub count: u32,
    #[serde(default)]
    pub is_foil: bool,
}
