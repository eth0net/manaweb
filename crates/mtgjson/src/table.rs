use std::fmt;

/// A per-table CSV export, which is what gets fetched rather than the whole
/// dump: `AllPrintings.json.gz` is 183.9MB and none of this needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Table {
    /// One row per product, with its contents as JSON in a column.
    SealedProducts,
    /// One row per decklist, each board keyed by MTGJSON uuid.
    SetDecks,
    /// uuid to everyone else's ids, Scryfall's among them.
    CardIdentifiers,
    /// The same for tokens, which [`Self::CardIdentifiers`] leaves out — and
    /// a decklist's `tokens` board is not the only place they appear.
    TokenIdentifiers,
    /// What each variant of each booster takes from each sheet.
    SetBoosterContents,
    /// How often each of those variants is the one in the wrapper.
    SetBoosterContentWeights,
    /// Each sheet a booster draws from, and its cards' weights summed.
    SetBoosterSheets,
    /// Every card on every sheet. 4.2MB against the other three at 100KB
    /// together, so the odds cost almost nothing beside the pool itself.
    SetBoosterSheetCards,
}

impl Table {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SealedProducts => "sealedProducts",
            Self::SetDecks => "setDecks",
            Self::CardIdentifiers => "cardIdentifiers",
            Self::TokenIdentifiers => "tokenIdentifiers",
            Self::SetBoosterContents => "setBoosterContents",
            Self::SetBoosterContentWeights => "setBoosterContentWeights",
            Self::SetBoosterSheets => "setBoosterSheets",
            Self::SetBoosterSheetCards => "setBoosterSheetCards",
        }
    }
}

impl fmt::Display for Table {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
