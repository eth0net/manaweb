// The components the compiler is allowed to skip, and why each is left alone.
//
// Every one here is a limitation of the compiler rather than a fault in the
// code: the alternative is contorting a correct function to suit a tool, and
// a duplicated cleanup path is a worse bug than a missed memo. An entry that
// stops matching fails the check, so a fixed one cannot sit here pretending
// to still be needed.

export interface Skip {
  /// Relative to the repository root.
  file: string;
  /// The compiler's own words, matched whole.
  why: string;
  /// How many functions in that file it says this about.
  count: number;
  /// Why this one stands rather than being rewritten.
  because: string;
}

const FINALLY =
  "(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause";
const BLOCKS =
  "Support value blocks (conditional, logical, optional chaining, etc) within a try/catch statement";
const MEMO = "Existing memoization could not be preserved";

export const SKIPPED: Skip[] = [
  {
    file: "web/src/collection/cards.ts",
    why: BLOCKS,
    count: 1,
    because:
      "A ternary inside the write path, which an if would only spread out.",
  },
  {
    file: "web/src/oauth/useSession.ts",
    why: BLOCKS,
    count: 1,
    because:
      "Builds the redirect argument from what the client came back with.",
  },
  {
    file: "web/src/scan/Readout.tsx",
    why: MEMO,
    count: 2,
    because:
      "Says the hand-written deps are wrong, which `web/camera-lenses` is already changing.",
  },
  {
    file: "web/src/scan/Report.tsx",
    why: FINALLY,
    count: 1,
    because: "Clears the sending flag down every path out.",
  },
  {
    file: "web/src/scan/Review.tsx",
    why: FINALLY,
    count: 2,
    because: "Clears the filing flags down every path out.",
  },
  {
    file: "web/src/scan/Scan.tsx",
    why: BLOCKS,
    count: 1,
    because: "A ternary in the read path, inside the catch that reports it.",
  },
  {
    file: "web/src/useCatalog.ts",
    why: FINALLY,
    count: 1,
    because: "Stamps the check time whether or not it succeeded.",
  },
];
