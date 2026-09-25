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

## Phase 0 — Collection tracking (done)

- Manual search + CSV import only. No scanner, no live pricing.
- Everything about the card cache is in [`scryfall.md`](scryfall.md); the
  client-side caching that keeps the server light is in
  [`architecture.md`](architecture.md).

**A local importer is a power-user option, not a way out of the ceiling.** A
CLI reading a ManaBox CSV would still need a live session and would still write
at 1,666 records an hour. It bought a connection that holds for five hours
rather than a phone's, and parts took even that away: the browser has the file
in the repo before anyone could open a terminal. `just seed` is the shape it
would take; still nobody's want.

## Phase 1 — Scanner

**Client-side inference.** Recognition runs in the browser (WASM) against a
precomputed index shipped with the catalog. No server in the per-scan path,
works offline, nothing leaves the device.

**Beat ManaBox on printing identification.** ManaBox matches art only, so the
user picks set and finish by hand every time. Exact printing ID is the feature
worth switching for.

- Constrain, don't classify. Art match narrows to the printings sharing that
  art; set symbol and collector number pick among those, which is a handful-way
  decision rather than 900-way classification.
- Collector number is the strongest signal. On modern frames the bottom line
  carries number, set code and rarity in a known font with a tiny alphabet, so
  a small purpose-trained model beats general OCR at a few hundred KB rather
  than Tesseract's ten-plus MB.
- **Set code, collector number and language identify a printing outright** —
  all three, which is what `cards::printing_id` takes and what the cache's
  unique index is on. The pair alone is unique only while the cache holds one
  language per printing; m10 #146 has nine ids. The language code sits beside
  the foil marker on the line the model already reads, so it costs nothing,
  but WotC's codes are their own rather than ISO 639 and need mapping to
  Scryfall's `lang`. Pre-M15 cards carry no code, leaving the printed name's
  own script as the signal.
- Foil is glyph classification, not computer vision. The premium indicator sits
  between set code and language on that same line: `BLB • EN` nonfoil,
  `BLB ★ EN` foil. Traditional foils share collector numbers with nonfoils, so
  this marker is the only differentiator.
- Era caveats: the M15 frame (2015+) puts it there; the Exodus frame
  (1998-2014) put a star next to the collector number. Older cards have no
  collector line, but foils didn't exist before Urza's Legacy (1999), so
  absence is itself a reliable nonfoil signal.
- Usually it doesn't arise — `finishes` narrows most pinned printings to one
  possibility.
- Proxies and alters defeat any scanner and always will. Accepted limitation.

**One implementation of the hash, in `crates/scanner`.** The build fills the
index and the browser queries it, and what it costs when the two differ is in
[`scryfall.md`](scryfall.md). So the hashing is a crate carrying no image
decoding, no database and no HTTP, which reaches wasm32 now and Swift and
Kotlin later. `manaweb-artwork` keeps the throttled pull, the JPEG
decoding and the measuring harness.

**It takes a luma plane and a stride, not an image.** iOS hands over
`420YpCbCr8BiPlanar` and Android `YUV_420_888`, each a Y plane wanting no
conversion, so the browser is the only caller that converts anything. The
stride is separate because those rows carry padding past their pixels, and
mistaking one for the other shears the picture.

**pHash at four insets, recall@1 97.2%** with every degradation at once —
misframing, rotation, blur, dim light and recompression — and 99.0% inside
ten, measured 2026-09-24 by `just measure-art` over 500 queries and the
54,584 artworks there is an image for. Framing is the one a global hash does
not shrug off, which is why an artwork is held at several crops rather than
at Scryfall's own — **and why the query is asked at several too.** Holding
them costs the file four entries an artwork; asking them costs four hashes of
one small frame, and is worth 0.8 points there and 1.4 on rotation alone, the
corners a rotation swings out of the picture being the same kind of error as
a bad crop.

Asking all four framings against every one of the index's 54,585 entries is
1.3ms in plain JavaScript, and 0.4ms at one, so WASM is for the detection and
rectification ahead of the hash rather than for the lookup.

**That number is not the one to judge the scanner by.** It asks which
*artwork* came back, and the two sides of one card are two artworks that
often look alike; the client resolves either to the same printings through
the pair, so a confusion the measurement scores as a miss is not one. What
wants measuring is which printing a photograph names, which `just photos`
scores over a directory of them, each named for the printing it shows.

**A card has to be found in a photograph before it can be hashed.** One is
looked for by its own outline and read back standing upright; where nothing
is found, the card is taken to fill each of five fractions of the frame in
turn, down to half of it. Either way the artwork is where it sits on a 2015
frame — `0.079..0.920` across and `0.114..0.554` down, measured off
Scryfall's own crop rather than taken from a diagram. Both go into the one
query and the report names which of them answered, so a run says what
detection is worth and not only what the two together score. Against 420 of
their card images, sixty of each shape, which is the capture nothing is
wrong with:

| shape | printing@1 | share of printings |
|---|---|---|
| modern | 100.0% | 55.3% |
| borderless | 98.3% | 4.8% |
| older | 96.7% | 30.7% |
| walker | 65.0% | 1.3% |
| full-art | 58.3% | 1.8% |
| token | 11.7% | 5.3% |
| sideways | 6.7% | 0.7% |

**92.5% weighted by how often each shape is printed.** Asking at more
framings than that costs nothing measurable: taking the floor from six
tenths of the frame to four moved no shape that works, so where a photograph
sits in that range is not something to ask a person to get right. The split is not
between frames but between shapes that have an art box and shapes that do
not: ordinary cards of either frame era are 86% of printings and the
rectangle is exactly right for them, down to a median distance of zero.
Tokens and planeswalkers have boxes of their own, a split card and a battle
are read sideways, and full-art has none — 9.1% of printings between them,
and no single rectangle reaches any of it. That is the case for detecting
the card and rectifying it rather than asking the person to frame it, and
the number a photograph is compared against rather than a target.

**On that set a detection can only be a false positive**, an image of theirs
being a card and nothing else, and one is reported in 74% of them: a 2015
frame's art box measures 0.73 where a card measures 0.716, so four corners
of the right shape are sitting inside every ordinary card. It answers 6.7%
of the shots and takes none of them away.

**49 photographs of real cards** say what that set cannot. Phone camera, a
pale surface, even light, the card upright and filling about three fifths of
the frame:

| shape | shots | printing@1 | detected | read |
|---|---|---|---|---|
| borderless | 9 | 100.0% | 100.0% | 77.8% |
| modern | 17 | 88.2% | 100.0% | 88.2% |
| older | 7 | 71.4% | 100.0% | 71.4% |
| full-art | 4 | 25.0% | 100.0% | 75.0% |
| token | 12 | 8.3% | 91.7% | 0.0% |

`detected` is how often a card was found at all and `read` how often its own
corners beat every guess at where one sits. **Fourteen of the eighteen misses
are tokens and full-art**, which is the shape problem above rather than
anything about the photographs. Set those two shapes aside and the other 33
score 87.9%, against a ceiling of 98.8% for the same three.

**The whole of that gap is foil.** Of the four misses left, three are foils
and the fourth is a near thing at ten bits:

| | shots | printing@1 |
|---|---|---|
| nonfoil | 22 | 95.5% |
| foil | 11 | 72.7% |

Under even light and no deliberate glare, so it is the treatment and not the
lighting. A foil scatters light its own way and the hash reads luma, so what
a camera records off one is not what was printed.

**Color reaches one channel inside the engine**, not at each caller. It is a
step of the hashing like any other, so the two sides have one statement of it
between them and the fingerprint covers it.

**The engine is reached over a C ABI, not a bindings generator.** The whole
surface is a luma plane in and four words out, so a pointer and a length say
it, and the same signatures serve a browser's `WebAssembly.Instance` and
later Swift and Kotlin. It builds with `cargo rustc --crate-type cdylib`
rather than a second crate, which keeps every native build free of exported
symbols. `tools/scanner-check` compiles it and holds it to what the native
build answers over the same probe — the hashes and the fingerprint, with and
without `+simd128`, which changes nothing: the vector extension gives the
compiler no license to reassociate a float. 45KB unoptimized.

Delivery is what the browser still owes. Pages builds the client and cannot
run cargo, so the module either ships committed under `web/public` or goes to
the bucket under a prefix of its own like the catalog. Whichever it is,
`web/public/_headers` allows `script-src 'self'`, which refuses to
instantiate WebAssembly until it names `'wasm-unsafe-eval'` as well — a
widening with nothing to justify it until something fetches the module.
`SharedArrayBuffer` is not worth the COOP/COEP headers it needs, which would
complicate the OAuth popup, and a transferred `ArrayBuffer` already copies
nothing.

**The artifact carries an illustration group per printing**, which is what an
art match narrows to — see [`scryfall.md`](scryfall.md). The client reads
past that column, so teaching it to map a match onto printings is the first
thing the scanner wants.

**The index is a build-time artifact, not a runtime service.** Building it
means pulling ~100k images (~10GB) and hashing them, which is hours on 1 vCPU.
Build locally, publish the artifact, serve it statically, same as `web/dist`.
Incremental per-set rebuilds (~300 cards) are fine on the box. Throttle the
initial pull: hammering Scryfall's CDN is the "repeated mishandling" that gets
API access restricted.

Client-side inference also removes the compute cost that would have been the
one meterable feature, and selling the index itself is both policy-murky and
unenforceable under AGPL. If a paid tier is ever wanted it's the server-side
fallback for cases client inference fails on — foil glare, poor lighting,
damage, non-English printings — plus bulk scanning from uploaded photos.

### What else a scanner could be made of

Surveyed 2026-09-25, so that what is built minimally now is a choice rather
than the only thing anyone thought of. The three stages want different
techniques and are not alternatives to each other.

**Finding the card is the gap, and it is worth more than any better hash.**
Four ways to:

| how | what it buys | where it fails |
|---|---|---|
| gradients to contours to the largest quadrilateral | the document-scanner pipeline; deterministic, no training data, pure arithmetic | a dark card on a dark table, a card on a card, an edge a highlight breaks |
| a line fit over those gradients | survives a gap, so a finger across one edge loses nothing | heavier, and wants its angles binned sensibly |
| an axis-aligned box from gradient energy alone | the cheapest thing that beats guessing | no rotation, no perspective |
| a small learned detector | robust to all of the above | training data, weights to ship, and the classification this design is built to avoid |

**The first is built**, into the engine so it reaches every platform: the
table is whatever can be walked to from the edge of the frame without
climbing a step of ten levels, the card is the largest thing left over, and
its four corners come off that run's hull. Refused if it is too small to
have been meant, the wrong shape — a card is 63 by 88mm, so the ratio is a
free filter — or not mostly made of those four corners.

**A step and not a level**, because a level cannot tell a dark card from the
shadow lying beside it and joins the two into one run reaching the edge of
the picture: that was 25 of the first 49 photographs, each coming back with
its lower corners pinned to the corners of the frame. A card's border is a
step and shading is not. Ten levels is the middle of a plateau — six to
twelve score alike and fourteen begins losing cards — rather than a figure
anything derives. What it still cannot do is a black border on a dark table,
where there is no step to stop at.

**Rectifying to a canonical rectangle is what makes it worth the work**,
rather than the art box, which already answers for ordinary cards — nothing
below can begin without a known position on a known shape. Built with it: a
card is read back through the projection its four corners came from, at its
own 63 by 88, which settles framing and perspective together and stands one
lying on its side back up. Which end of it is the card's top is the one
thing left over, and nothing answers that yet.

**Matching the artwork wants leaving alone.** The alternatives are real and
each trades away something this design is built on:

| how | index for 54,585 artworks | why not now |
|---|---|---|
| a perceptual hash, as built | 2.6MB | — |
| local features and a geometric check | gigabytes | robust to occlusion and perspective, and it ends shipping the index to a browser |
| a learned embedding | 7–27MB and weights | the answer if the hash proves insufficient, which nothing has shown |
| color beside the hash | 2.6MB more | cheap, and the one worth watching for |

That last is the gap in what exists: the hash reads luma and throws color
away, so two artworks of similar composition and different palette are the
confusion it cannot see. A four-by-four grid of mean color is forty-eight
bytes an artwork. Not added speculatively — the margin a photograph scores
by is the diagnostic, and adding it before that says which artworks are
being confused would be answering a question nobody has asked.

**Two cheap things are missing that are not techniques at all.** A camera
gives thirty frames a second where this thinks in photographs, and taking
the sharpest by gradient energy, or voting across several, is most of the
answer to blur and glare — the glare moves between frames and the card does
not. And nearest-neighbor always returns something, so a wrong printing
enters a collection silently; a confidence floor read off the margin is what
lets it say to try again instead.

The order, then: which way up a rectified card is, frame selection, a
confidence floor, then reading the collector number. Color, or anything
heavier, only where a measurement asks for it.

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

## The icon takes a theme

The drawing was already in the pieces it needed to be: three paths are the six
radial spokes, one is the inner ring, one is the outer. So the split was fills
plus a `clipPath` from the inner ring, which catches the lengths of spoke
inside it and makes those the crystal.

Twelve corners, alternating between radius 31 and radius 26 — six long points
with a shallow dent between each pair, which reads as a hexagon rather than the
circle a regular twelve-sided shape would. The points sit at the six spoke
angles, so the crystal terminates the spokes instead of crossing them.

Four tokens carry the whole thing: `--web`, `--core`, `--facet` and `--glow`,
set on the `svg` element so a page that inlines it can override them. A token
takes `url(#id)` as readily as a color, so a gradient preset needs the gradient
in `defs` and nothing else — the shape of a theme is already a row of four
values, whatever kind each one is.

`just write-icons` is the composer that follows from that. It resolves the
tokens to concrete fills, since the renderer reads no custom properties, then
adds a background and an inset, and writes every raster the app ships from the
one drawing.

Two of those exist for Android alone. A launcher crops a home screen icon to
whatever shape it uses and guarantees only the middle 80%, and it fills a
themed icon from the wallpaper after throwing away every color in it — so one
raster is inset on an opaque background and another is the silhouette, and
neither is what a browser tab wants. iOS takes its icon once, when the app is
added, and the dark alternative is offered through a media query the same way
the favicon's already is. Whether Safari reads it there is untested.

**A composed app icon is a shipped one, not a chosen one.** iOS fixes a PWA's
icon when it is added to the home screen, and a native app's alternates have to
be in the bundle and picked from a fixed list; Android can take a manifest
change but on its own schedule. So composing produces the set that ships, and
a live choice only reaches the surfaces the app draws itself — the header, and
the SVG the browser reads. The rasters are where a theme is baked in.

## Multi-TCG (deferred, maybe never)

If it ever happens, it's a **fork, not a namespace**: pull the genuinely shared
parts into libraries and build a separate app with its own NSID root. The
domain models barely overlap — no color identity in Pokémon, different
legality rules, different recognition problem — so one namespace tree
straddling both would couple things that want to stay apart.

Trading is explicitly **out of scope** either way. This is a
personal-collection tool, not a marketplace.
