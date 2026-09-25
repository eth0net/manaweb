use std::collections::BTreeMap;
use std::fmt;

use serde::Deserialize;
use serde_json::value::RawValue;
use uuid::Uuid;

/// One printing, trimmed to what Manaweb queries.
///
/// Absent fields are absent rather than empty, and not only on obscure cards:
/// `reversible_card` carries no top-level `oracle_id`, `cmc`, `mana_cost`,
/// `type_line`, `oracle_text` or `colors`, and every transform-like layout
/// drops `mana_cost` and `colors`. What they omit lives on `card_faces`.
///
/// Open taxonomies — `layout`, `rarity`, `set_type`, `finishes`, `games`,
/// `legalities` — stay strings, since Scryfall adds values without notice:
/// `layout` gained `front_card` between the roadmap and this crate.
#[derive(Debug, Clone, Deserialize)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the card object, which has this many flags"
)]
pub struct Card {
    pub id: Uuid,
    pub oracle_id: Option<Uuid>,
    pub name: String,
    /// The name in `lang` when that isn't English — 2,673 printings in Default
    /// Cards, and the only way to find them by name.
    pub printed_name: Option<String>,
    pub printed_type_line: Option<String>,
    pub printed_text: Option<String>,
    pub lang: String,
    pub released_at: String,
    pub layout: String,

    #[serde(rename = "set")]
    pub set_code: String,
    pub set_name: String,
    pub set_type: String,
    pub collector_number: String,
    pub rarity: String,

    pub mana_cost: Option<String>,
    pub cmc: Option<f32>,
    pub type_line: Option<String>,
    pub oracle_text: Option<String>,
    pub colors: Option<Vec<Color>>,
    pub color_identity: Vec<Color>,
    pub power: Option<String>,
    pub toughness: Option<String>,
    pub loyalty: Option<String>,
    pub defense: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub legalities: BTreeMap<String, String>,
    #[serde(default)]
    pub games: Vec<String>,
    #[serde(default)]
    pub finishes: Vec<String>,

    pub digital: bool,
    pub promo: bool,
    pub reprint: bool,
    pub variation: bool,
    pub oversized: bool,
    pub booster: bool,
    pub full_art: bool,
    pub textless: bool,
    pub reserved: bool,
    pub border_color: String,
    pub frame: String,
    pub artist: Option<String>,
    /// Which artwork this printing carries. Printings sharing one are what an
    /// art match narrows to — see `docs/scanner.md`.
    pub illustration_id: Option<Uuid>,
    pub flavor_text: Option<String>,

    /// Kept when the image URLs themselves are not: `missing` and `placeholder`
    /// printings have nothing behind the URL derived from the id.
    pub image_status: String,

    /// Irregular across layouts, so it stays JSON rather than becoming columns
    /// or a second table.
    pub card_faces: Option<Box<RawValue>>,

    #[serde(default)]
    pub prices: Prices,
    pub edhrec_rank: Option<u32>,
    pub game_changer: Option<bool>,
}

/// Decimal strings as Scryfall sends them. `None` means unpriced, not free, and
/// turning these into money is the caller's job.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Prices {
    pub usd: Option<String>,
    pub usd_foil: Option<String>,
    pub usd_etched: Option<String>,
    pub eur: Option<String>,
    pub eur_foil: Option<String>,
    pub eur_etched: Option<String>,
    pub tix: Option<String>,
}

/// Magic's five colors — the one Scryfall taxonomy the game's rules close.
///
/// Declared in WUBRG order, so sorting a slice canonicalizes it and color
/// identities compare as strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
pub enum Color {
    W,
    U,
    B,
    R,
    G,
}

impl Color {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::W => "W",
            Self::U => "U",
            Self::B => "B",
            Self::R => "R",
            Self::G => "G",
        }
    }
}

impl fmt::Display for Color {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
