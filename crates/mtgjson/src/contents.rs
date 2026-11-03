use serde::{Deserialize, Deserializer, de::Error as _};
use uuid::Uuid;

/// What a product holds.
///
/// Every arm is optional and a product may carry several. Which arm an entry
/// sits in is the thing to read before showing any of it — `docs/products.md`.
/// An arm nobody has written down yet parses as absent rather than failing,
/// which keeps an unattended refresh off a kind MTGJSON adds later.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Contents {
    /// A named printing. Exact.
    #[serde(default)]
    pub card: Vec<Printing>,
    /// A named decklist in `setDecks`. Exact.
    #[serde(default)]
    pub deck: Vec<Named>,
    /// A count of another product, so this recurses into whatever that holds.
    #[serde(default)]
    pub sealed: Vec<Sealed>,
    /// A booster config name, which the set's own `booster` object turns into
    /// weighted sheets. Never resolves to cards here, and never to certainty.
    #[serde(default)]
    pub pack: Vec<Pack>,
    /// Configs that differ between copies — the same product, packed several
    /// ways, with no way to know which one is in hand.
    #[serde(default)]
    pub variable: Vec<Variable>,
    /// A name and nothing else: spindowns, storage, life trackers.
    #[serde(default)]
    pub other: Vec<Piece>,
    /// How likely this configuration is, and only ever set inside a
    /// [`Variable`]'s configs. Without it the configs read as equally likely,
    /// which for a Welcome Deck weighted 330 against 4 is the wrong answer.
    #[serde(default)]
    pub variable_config: Vec<Chance>,
}

/// The odds on one configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct Chance {
    /// Relative to the other configs, not out of a hundred.
    pub weight: u32,
    pub chance: u32,
}

/// One printing, named the way the card cache already indexes it.
#[derive(Debug, Clone, Deserialize)]
pub struct Printing {
    pub name: String,
    #[serde(rename = "set")]
    pub set_code: String,
    /// Scryfall's collector number, star suffixes and all.
    pub number: String,
    pub uuid: Uuid,
    /// Stays strings, as Scryfall's finishes do.
    #[serde(default)]
    pub finishes: Vec<String>,
    /// Set where it is true and absent otherwise, which is why these are not
    /// derived from `finishes` — the two are written independently.
    #[serde(default)]
    pub foil: bool,
    #[serde(default)]
    pub etched: bool,
    /// Tokens key against `tokenIdentifiers`, never `cardIdentifiers`.
    #[serde(default)]
    pub token: bool,
}

/// A decklist by name, resolved against `setDecks` in the same set.
#[derive(Debug, Clone, Deserialize)]
pub struct Named {
    pub name: String,
    #[serde(rename = "set")]
    pub set_code: String,
}

/// Another product, by uuid.
#[derive(Debug, Clone, Deserialize)]
pub struct Sealed {
    pub name: String,
    #[serde(rename = "set")]
    pub set_code: String,
    pub uuid: Uuid,
    pub count: u32,
}

/// A booster config, by the name the set's `booster` object keys on.
#[derive(Debug, Clone, Deserialize)]
pub struct Pack {
    pub code: String,
    #[serde(rename = "set")]
    pub set_code: String,
}

/// One product packed several ways.
#[derive(Debug, Clone, Deserialize)]
pub struct Variable {
    pub configs: Vec<Contents>,
}

/// Something that isn't a card.
#[derive(Debug, Clone, Deserialize)]
pub struct Piece {
    pub name: String,
}

/// Reads a column holding JSON rather than a scalar.
///
/// The CSV exports keep every nested field as a JSON string in one cell, so
/// the whole union arrives as text and is parsed a second time.
pub(crate) fn column<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let raw = String::deserialize(deserializer)?;
    if raw.is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(&raw).map_err(D::Error::custom)
}
