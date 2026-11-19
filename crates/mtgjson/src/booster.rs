use serde::Deserialize;
use uuid::Uuid;

/// What one variant of a booster takes from one sheet.
///
/// A config's variants differ in a slot or two, so the range a wrapper prints
/// is the least and greatest `sheet_picks` over them, and a sheet missing from
/// a variant reads as none of it — `docs/products.md`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub set_code: String,
    /// The config this belongs to, keyed as the set's own `booster` object
    /// keys it: `play`, `collector`, `draft`.
    pub booster_name: String,
    pub booster_index: u32,
    pub sheet_name: String,
    pub sheet_picks: u32,
}

/// How often a variant is the one in the wrapper.
///
/// Out of the config's own total rather than out of anything fixed: the four
/// `blb` play variants weigh 788, 12, 197 and 3.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub set_code: String,
    pub booster_name: String,
    pub booster_index: u32,
    pub booster_weight: u32,
}

/// A sheet a slot draws from, and what its cards' weights add up to.
///
/// `sheet_total_weight` is the denominator a pull's own weight sits over, and
/// is given rather than summed so a partial read still divides.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub set_code: String,
    pub booster_name: String,
    pub sheet_name: String,
    pub sheet_is_foil: bool,
    /// Whether the sheet is drawn to even out colors, which makes a pull's
    /// weight an approximation rather than the whole story.
    pub sheet_has_balance_colors: bool,
    pub sheet_total_weight: u32,
}

/// One card on one sheet, which is the pool a pack can draw from.
///
/// The uuid reaches a printing through `cardIdentifiers`, the same table the
/// decklist boards already need.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    pub set_code: String,
    pub booster_name: String,
    pub sheet_name: String,
    pub card_uuid: Uuid,
    pub card_weight: u32,
}
