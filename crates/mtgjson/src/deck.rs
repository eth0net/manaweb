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
    /// `None` where MTGJSON wrote `not_in_mtgjson` instead of an id — 24
    /// token entries, and nowhere else in either table. Any other value that
    /// isn't an id still fails, rather than quietly becoming nothing.
    #[serde(deserialize_with = "absent_or_uuid")]
    pub uuid: Option<Uuid>,
    pub count: u32,
    #[serde(default)]
    pub is_foil: bool,
    /// Set with [`Self::is_foil`] every time, never instead of it, so taking
    /// that flag at face value files an etched printing as foil — a different
    /// finish rather than a shade of one.
    #[serde(default)]
    pub is_etched: bool,
}

/// What MTGJSON writes when a board names something it has no id for.
const ABSENT: &str = "not_in_mtgjson";

fn absent_or_uuid<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Uuid>, D::Error> {
    use serde::de::Error as _;

    let raw = String::deserialize(deserializer)?;
    if raw == ABSENT {
        return Ok(None);
    }
    raw.parse().map(Some).map_err(D::Error::custom)
}
