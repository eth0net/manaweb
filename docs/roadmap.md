# Manaweb roadmap

Phases and scope. The reasoning behind each decision lives alongside its
subject: [data model](data-model.md), [architecture](architecture.md),
[Scryfall](scryfall.md), [atproto](atproto.md), [licensing and IP](ip.md).

All of it records decisions and *why*, so future work doesn't re-derive them.
None of it is a spec to build against literally. Update as things change.

## Philosophy

- MTG-first, and effectively MTG-only. Nothing generic is built for games that
  don't exist; a second TCG would be a fork, not a configuration.
- Personal/hobby scope: one user first, a handful of friends is the realistic
  ceiling.
- Design carefully where mistakes are expensive (lexicon NSIDs, required
  fields — permanent once records exist in other people's PDSes); move fast
  where they're cheap (our DB is a disposable index).

## Running costs

Cost per user is very low: the client does search and scanning, the PDS holds
the data, and the fixed Scryfall sync dominates. This may never need funding.

If it does, donations first, ads only if genuinely necessary, self-hosting free
regardless. Both are permitted by the policies in [`ip.md`](ip.md). Not a
business.

Inference on the device also removes the compute that would have been the one
meterable thing, and selling the index is both policy-murky and unenforceable
under AGPL. A paid tier, if one is ever wanted, is the server-side fallback
for what the client cannot do — foil glare, poor light, damage, a non-English
printing — and bulk scanning from uploaded photographs.

## Phase 0 — Collection tracking (done)

- Manual search + CSV import and export. No scanner, no live pricing.
- Everything about the card cache is in [`scryfall.md`](scryfall.md); the
  client-side caching that keeps the server light is in
  [`architecture.md`](architecture.md).

**Export was never a phase, and should have been.** A collection nobody can
get back out is one you are asked to take on trust, which is the opposite of
the claim in [`scryfall.md`](scryfall.md). ManaBox and a shape of our own
read both ways so far; Moxfield, Archidekt and Toploader OS are each a
binding and a header, not another writer. What writing one has to decide is
in that file too.

**A local importer is a power-user option, not a way out of the ceiling.** A
CLI reading a ManaBox CSV would still need a live session and would still write
at 1,666 records an hour. It bought a connection that holds for five hours
rather than a phone's, and parts took even that away: the browser has the file
in the repo before anyone could open a terminal. `just seed` is the shape it
would take; still nobody's want.
## Phase 1 — Scanner

All of it is [`scanner.md`](scanner.md): what a photograph retrieves, what
that was measured against, and what each thing nobody has built would cost.

The engine reaches a browser: it ships with the app, reads a card out of a
frame, and answers with the nearest artworks and how far off the runner-up
was. A tab holds a camera over it, a scan makes a stack in a list the browser
keeps, and keeping that list is the import path. What is missing is the
settings the overlay and the session priors both want.

## Phase 2 — Valuation

- Price cache table, separate from the card cache, keyed `scryfall_id` +
  source + timestamp.
- **There is no prices bulk file.** The seven bulk types are `oracle_cards`,
  `unique_artwork`, `default_cards`, `all_cards`, `rulings`, `art_tags` and
  `oracle_tags`; prices exist only as fields inside card objects. So a faster
  cadence has no cheap mechanism: it means re-pulling the whole file, or
  ~100k per-card API calls at 10/s. The separate table is still right; the
  decoupled refresh was wishful. Decide the real cadence when Phase 2 starts.
- **Scryfall prices can't fund a paid tier.** They come from Scryfall's
  affiliates, the no-paywall clause covers them, and their own guidance is that
  prices are "dangerously stale after 24 hours", for trends and estimates only,
  "not updated frequently enough to power a storefront".
- If valuation is ever sold, re-source it — TCGplayer and Cardmarket run
  affiliate programs with commercial terms. Otherwise keep it free.
- Valuation is collection entries × latest cached price. No new architecture.

**What a sealed product holds is a different source.** Scryfall says whether a
printing appears in boosters and nothing about which product or sheet it came
off; MTGJSON publishes booster configurations and sealed contents, so knowing
what a box can yield means a second feed and a part of its own. Wanted for
splitting a sealed purchase across what comes out of it, and for answering
"where do I open this" — not scheduled, and it earns a phase only once
valuation exists to make either question worth asking.

## Phase 3 — Decks

- **This is where Jetstream arrives.** Explore needs indexing across users,
  the first thing a local-first client genuinely can't do for itself.
  Subscribe with `wantedCollections` scoped to our own NSIDs, network-wide —
  cheap, since only Manaweb users emit matching events.
- **A card nobody here owns is fetched, not carried.** Explore shows decks
  built by people whose printings may be in no language pack anyone
  installed, and the answer is the network with a light cache rather than a
  bigger artifact: the base is Default Cards and the packs are opt-in, so
  broadening either to cover a deck somebody else built would charge every
  user for it. See [`scryfall.md`](scryfall.md).
- **The index stops being disposable here.** Activity seen only over the
  firehose can't be re-derived from Scryfall or from anyone's PDS, so it wants
  a SQLite file of its own and a backup story — R2 snapshots, or something
  else. Reasoning in [`architecture.md`](architecture.md).
- Deck records live in the owner's PDS, same single-owner model as collection
  entries.
- A deck's container reference is **optional**, created the first time it is
  physically built, so pure concepts don't litter the model with empty
  containers.
- Three ways to add a card, one schema: bind to a print you own (default), pick
  one deliberately for flavor, or omit it for "any printing". Legality
  checking and recommendations key on `oracle_id`, which every entry carries.
- **Visibility flag on the record**, for decks, lists and collections:
  `visibility: "unlisted" | "published"`. Not access control — atproto records
  are publicly fetchable regardless. It only controls whether our AppView
  mirrors the record into Explore and whether our UI surfaces it. See Sharing
  in [`atproto.md`](atproto.md).
- Genuinely *collaborative* multi-owner decks are harder — atproto has no
  multi-writer record. The standard pattern is one canonical owner record plus
  member-contributed records aggregated by the AppView, as Bluesky Lists do.
  Deferred; not needed for solo publishing.

## Phase 4 — Recommendations

**Ingesting EDHREC is not permitted.** Their Terms of Use (Aug 2024, Space Cow
Media) grant access "solely for your own personal, noncommercial use", prohibit
derivative works, and bar using "software or automated agents or scripts to
generate automated searches, requests, or queries to the Site". The keyless
`json.edhrec.com` is still their infrastructure, and leaning on a gap between
it and "the Site" would be lawyering around plain intent. Their robots.txt is
permissive about crawling, but robots.txt isn't a license.

**Link out instead.** A link a human clicks is the user's own browser doing
what their personal-use license contemplates, so card pages and search URLs are
equally fine. What's barred is *our code* fetching either: no prefetch, no
server-side fetch for preview cards, no iframes. Asking them directly is also a
real option; small MTG projects do get informal arrangements.

**Our own recommendations, aimed elsewhere.** The hard part isn't the model,
it's the corpus: co-occurrence data means our users' decks (empty until Explore
has scale) or someone's scrape, and anything sourced from EDHREC taints the
model too.

- Most practical value needs no deck corpus. Type lines, mana costs, color
  identity, oracle keywords and combo detection are computable from Scryfall
  data we already hold.
- That buys what EDHREC structurally can't do: **recommendations constrained to
  cards you own.** "Your commander cares about artifacts, here are eleven in
  your binders" is a different product, not a worse copy — no cold start,
  license-clean, landing on the collection index we already have.
- Same build shape as the scanner index: precompute offline, ship the artifact,
  serve it statically.
- Co-occurrence is a later enhancement, once Explore provides a corpus of our
  own — and the same index answers what search borrows from EDHREC today, in
  [`search.md`](search.md).

## Phase 5 — Game toolkit (life totals, dice, game history)

- **Architecturally separate** from the collection/deck model. Don't tangle it.
- Live game state is high-frequency and ephemeral, a bad fit for PDS records —
  no network write per point of damage. Keep it client-side during play, with
  peer-to-peer sync between devices for a shared table view if needed.
- Persist only an optional *summary* record at game end (final life totals,
  winner, deck used, date).
- Own lexicon namespace, `app.manaweb.game.*` — "game" here means a game
  being played, not which TCG. Kept apart from collection and deck lexicons.

## Multi-TCG (deferred, maybe never)

If it ever happens, it's a **fork, not a namespace**: pull the genuinely shared
parts into libraries and build a separate app with its own NSID root. The
domain models barely overlap — no color identity in Pokémon, different
legality rules, different recognition problem — so one namespace tree
straddling both would couple things that want to stay apart.

Trading is explicitly **out of scope** either way. This is a
personal-collection tool, not a marketplace.
