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
}

impl Table {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SealedProducts => "sealedProducts",
            Self::SetDecks => "setDecks",
            Self::CardIdentifiers => "cardIdentifiers",
            Self::TokenIdentifiers => "tokenIdentifiers",
        }
    }
}

impl fmt::Display for Table {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
