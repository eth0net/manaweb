# Scryfall

Card data comes from Scryfall, and its shape drives most of the cache. Their
terms are in [`ip.md`](ip.md); what the client does with the artifact is in
[`search.md`](search.md).

## Bulk data and the cache

- Card cache from **Default Cards** (~78MB compressed), and the client resolves
  anything missing from it directly against Scryfall's API. Their CORS policy
  is `access-control-allow-origin: *` with a 48-hour `cache-control`, so a
  browser can fetch a single printing and cache it in IndexedDB permanently.
  Each exotic card is fetched once per device, ever.
- That means **All Cards (~392MB) isn't needed server-side for v0**. Default
  Cards omits most non-English printings, which was the argument for the big
  file; on-demand client resolution covers them instead, and the server DB
  stays small. All Cards may return at Phase 3, when the AppView indexes other
  people's records and has to resolve arbitrary printings itself.
- **Don't push catalog load onto Scryfall wholesale.** Per-keystroke search
  against their API would be externalizing our load onto a free service that
  publishes bulk files specifically so apps don't do that — and it's our API
  access that gets restricted. Serving a trimmed 4-5MB artifact ourselves is
  cheaper for everyone, and it's static, so a CDN makes it near-free.
- The client gets a subset of the cache, not all of it — what, and what it
  weighs, is settled below.
- Bulk files are **gzipped JSONL**, one card per line, served as
  `application/gzip` with an ETag and `accept-ranges`. Stream line by line;
  parsing whole will OOM a 1GB box. The index entry gives
  `jsonl_download_uri` and `compressed_size` — the older `download_uri` /
  `content_encoding` pair is gone.
- **Card objects aren't uniformly shaped, and this bites on the first sync.**
  `layout: reversible_card` has no top-level `oracle_id`, `cmc`,
  `mana_cost`, `type_line`, `oracle_text`, `colors` or `image_uris` — all on
  `card_faces`. Transform layouts have null top-level `mana_cost` and
  face-level images. So `oracle_id` cannot be `NOT NULL`, and the cache needs
  `layout` and `card_faces`.
- **Taxonomies grow without notice**, so `layout`, `rarity`, `set_type`,
  `finishes`, `games` and `legalities` stay strings in the parse layer. A
  weekly unattended sync shouldn't fail on a new value, and two undocumented
  layouts (`front_card`, `prepare`) turned up on the first real run. Colors
  are the exception: the game's rules close that set.
- Measured on 2026-09-18: 118,239 printings, streamed and parsed in seconds.
  The parse is not the expensive part of a refresh.
- The bulk files include digital-only printings, tokens and art series. Which
  of those search surfaces is settled below; the cache keeps all of them,
  since a printing you can own has to be findable.
- Refresh weekly — Scryfall says gameplay data needs fetching "once per week or
  right after set releases". The API also requires an accurate `User-Agent`
  naming the app, explicitly not a library default. `manaweb_scryfall::USER_AGENT`
  is the only place it is spelled, and CI holds a tag to that same version.
- Don't ship image URIs; they derive from the card id as
  `cards.scryfall.io/{size}/front/{id[0]}/{id[1]}/{id}.jpg`, the query string
  being a cache-buster. Keep `image_status` — `missing`/`placeholder` printings
  have nothing behind that URL. Back faces use `/back/`, and `png` ends `.png`.
- Import/export is client-side and costs us nothing. ManaBox CSV both ways
  first, since it's the likeliest source of an existing collection, then
  Moxfield, Archidekt, Deckbox and a plain `scryfall_id`+quantity shape. Being
  easy to leave is the data-ownership pitch made concrete.

## Serialized cards are a printing, not a copy

Scryfall models the printing and stops there. A serialized card carries
`serialized` in `promo_types` — 299 printings across 20 sets, collector numbers
ending `z`, and `is:serialized` filters them. The Lord of the Rings 1-of-1 One
Ring is collector number `0`.

**Neither the print-run size nor the individual number exists anywhere in
Scryfall.** So "042/500" is data we hold with nothing to validate it against.
An optional `serial` string on `app.manaweb.card` covers it, with quantity 1
whenever it's set, since numbered copies aren't interchangeable. Additive, so
it can wait for an import path that carries one.

## Scryfall id migrations are smaller than they look

2,581 migrations exist: 2,354 deletes and 227 merges. A merge gives
`new_scryfall_id`, so it's a remap; a delete gives no replacement.

Most are corrections of printings that never existed, which nobody can have
owned, and the rate has collapsed since 2023.

Consume them weekly alongside the bulk sync. Remap merges silently; surface
deletes, because some carry no metadata and an orphaned reference to one of
those can't be interpreted at all. The rest preserve name, set, collector
number and oracle id, so an orphan usually stays readable.

## What other trackers actually export

Sample CSVs from five tools, since these are the import targets and their
columns are the evidence for what a collection row needs.

| | container | trade qty | tags | notes | serial | price paid | date added | date bought |
|---|---|---|---|---|---|---|---|---|
| ManaBox | Binder Name + Type | — | — | — | — | yes | yes | — |
| Moxfield | — | yes | yes | — | — | yes | — | — |
| Dragon Shield | Folder Name | yes | — | — | — | yes | — | yes |
| MTGGoldfish | — | — | — | — | — | — | — | — |
| TCGplayer | — | — | — | — | — | — | — | — |

**No tracker records a serial number**, which settles the serialized question:
treat it as the promo printing it is. Scryfall lists `serialized` alongside
`boosterfun` and `doublerainbow`, and a dedicated field's key invariant —
quantity 1 — can't be expressed in a lexicon anyway, so it would be a
client-side rule other implementers break.

Two columns we would silently drop, both worth settling before import ships:

- **Price paid**, in three of five, and Dragon Shield adds date bought. That is
  collection data rather than market data, so it is not the Phase 2 price
  cache.
- **Trade quantity**, in two of five. Our model says that's a trade list, which
  is better, but the column has nowhere to land on import.

ManaBox's Binder Name and Type map onto containers, and Dragon Shield's Date
Bought onto an acquisition's `at`. `note` and `tags` between them give
serialized numbers, misprints, alters and provenance a home without a typed
field each.

Only ManaBox's whole-collection export names a binder per row. A binder export
and a list export carry the same sixteen columns with nothing distinguishing
them, though one is cards you own in one container and the other references
you may not own, so import asks which it is rather than sniffing the header.

Import parses rather than splits: card names carry commas inside quotes, and
nothing guarantees a line ending or rules out a leading BOM across five tools
and the browsers and systems they run on. The fixtures are stored LF, and a
test varies the ending rather than a second file carrying it.

### A format is a binding, not a reader of its own

Every supported format is a table of field against column name, and one reader
is driven by it. A custom mapping is then the same table built in the browser
from whatever headers a file turns out to have, rather than a second
implementation, and an export is the table read backwards.

It also puts the price decision somewhere a user can overrule it. ManaBox binds
its `Purchase price` column to `marketValue`; anyone who really did type their
own figures rebinds that one field to `price`, and the opt-in needs no setting
of its own.

Values get the same treatment. Where vendors spell a finish or a grade
differently, the spellings are gathered per field and grow as formats land,
because inventing a vendor's vocabulary before holding one of its exports is
how an import silently mangles a collection.

### What you paid is not what it was worth

ManaBox's `Purchase price` holds two different things. Left alone it fills in
the market price at the moment you add a card, so a column named for what you
paid is often just a snapshot, and afterwards the two are indistinguishable.
That makes its profit-and-loss really "market drift since I added it" wearing
a P&L label.

Measured across a real export: 251 identity keys repeat, and 216 of them differ
only in price. The same card at a different figure each time is a snapshot of
the market on the day the row was added, not something anyone typed.

So an acquisition carries both, named for what they are: `price` is what you
paid and is absent when you didn't say, `marketValue` is what a copy was worth
when the row was written — for an import, the day it was catalogued rather than
the day it was bought. Both are decimal strings, because money is not a float,
and both carry their own currency — Scryfall quotes USD and EUR, and you may
well have paid in neither. `marketValue` has to be stored rather than derived
later, since Scryfall publishes no price history and no prices bulk file.

Two honest figures come out of that instead of one false one: what you paid
against what it is worth now, over the cards where cost is known and showing
that coverage, and drift since the row was added, which works everywhere
because we snapshot it. Drift since acquisition is a different figure needing a
purchase date, which only Dragon Shield exports.

**A ManaBox import writes `marketValue`, not `price`.** We cannot tell an
edited row from an auto-filled one, and the costs are not symmetrical: putting
an unpaid amount in `price` produces a confident lie in every comparison
afterwards, where the reverse produces a gap. People who diligently edited
theirs get an opt-in.

ManaBox's `Added` seeds `createdAt`. It records when a row entered ManaBox
rather than when the cards were bought, so a collection catalogued in bulk
carries one timestamp across everything added that session. Dragon Shield's
Date Bought is the other fact and seeds an acquisition's `at`. MTGGoldfish and
TCGplayer export no date, so those imports leave `createdAt` at import time.
Moxfield's `Last Modified` seeds `updatedAt`.

## Oracle and printing are two tables

Which fields belong to a card rather than a printing was measured, not
guessed: group every printing by `oracle_id` and count the columns that
disagree. Six never do — `color_identity`, `defense`, `edhrec_rank`,
`game_changer`, `keywords`, `reserved`. Ten more disagree for 71 cards, and
every one of those 71 is a reversible printing sharing an id with a normal
one, whose nulls are the whole disagreement.

So `name`, `type_line`, `mana_cost`, `cmc`, `oracle_text`, `colors`, `power`,
`toughness`, `loyalty` and `defense` are card-level. `legalities` is not: 2% of
cards have printings that disagree, because a gold-bordered reprint is legal
nowhere. Neither is `layout` — a card printed both normally and reversibly has
two shapes, and that is a fact about the objects.

**The split repairs reversible printings rather than merely deduplicating
them.** They carry no top-level gameplay data at all, so there was nowhere for
it to come from; the card's row is filled from the best-ranked printing and any
field still missing from whichever printing has it. All 81 now resolve to a
card with a type line.

Best-ranked is not first-seen: a reversible printing can be a card's best, so
a printing arriving later can displace what earlier ones established.
The two merge either way round rather than the later one starting over, or the
file's order would decide what a card's type line is.

Measured: the database drops by about an eighth and the client's gameplay
payload by nearly two thirds — the artifact is the real prize, being the
difference between hitting a 4-5MB target and missing it.

`kind`, `paper`, `printings` and `default_print` are derived onto the card row
at sync time, so search needs no window functions and no `bm25` gymnastics.
`printings` counts paper only, being what a collector could own.

## What the client artifact holds

Two files under one version. Positional rows with their column names in a
header, written uncompressed for a CDN to compress.

| | rows | uncompressed | brotli |
|---|---|---|---|
| cards | 37,821 | 4.64MB | 1.29MB |
| prints | 108,883 | 7.89MB | 2.73MB |

Measured 2026-09-18: 4.01MB over the wire, at the top of the 4-5MB target in
[`architecture.md`](architecture.md). It grows with the game, so treat the
target as the thing to hold and this as the last time anyone looked.

**Printings are grouped by card, in the cards file's order**, so a card's
printings are the run of `printings` rows where the preceding counts end, and
the leading row is the printing search would show. That is why the pair carries
one version and why the build refuses to publish runs that don't add up: an
index read against the wrong ordering is wrong quietly.

**Names are per card. Printed names are per printing** — the few paper printings
carry one, 32KB in total, so a Japanese card is found by the name on its own
printing and no per-language index is needed.

**Ids stay 36-character hex.** Base64 of the UUID bytes is smaller but costs
every consumer a decode before it can write a `scryfallId` or build an image
URL. In reserve for when the artifact needs shrinking.

**Rows are fixed width.** Trimming trailing nulls and zeros saved 1.8%, which
doesn't pay for a format where a row's length means something.

Low-cardinality columns are integers indexing tables in the header — sets,
rarity, layout, image status, language, and finishes as a bitmask. Each list
runs commonest first, so the value that repeats most is one digit.

**What a search result has to show chose the remaining columns**: EDHREC rank
at 100KB compressed, since a name search with no popularity signal is bad
enough to notice; power and toughness; the reserved list; and the printing's
artist, the dearest at 175KB and the one to drop first.

**A rare field can't be its own column.** Loyalty is on 316 cards and would
spend a `null` on the other 37,248 — 186KB to say nothing. So power and
toughness, loyalty and defense share one column: they never co-occur and print
in the same corner, and the type line says which it is. Booleans — reserved,
game changer and whether it can head a deck per card, promo, variation, full
art, textless and oversized per printing — are bits in one integer, named by
the header the way finishes are, so a flag added later needs no change in a
client.

**Battles keep their defense on `card_faces`**, so only two cards carry one at
the top level. Inside the fold it costs nothing, so it stays.

Left out: oracle text, keywords, legality, frame and border color, and a
printing's own release date — the set carries one. Oracle text is the third file
when decks arrive.

## What to cache, and when

The pair the client fetches today is the floor: names, types and printings,
which search and collection tracking cannot work without. Everything past it
is opt-in, because the point of a catalog on the device is that someone chose
to hold it.

| part | raw | brotli | when |
|---|---|---|---|
| cards, prints | 12.53MB | 4.01MB | always |
| text — oracle text | 5.70MB | 0.57MB | opt-in: offline viewing, text search |
| names, per language | | ~300KB each | opt-in: chosen at onboarding |
| art | unbounded | unbounded | opt-in, per card, the service worker's |

Raw matters as much as brotli: one is the download and the other is what the
device keeps. Text is nearly half again on disk and a seventh on the wire,
which is small in absolute terms and still a choice worth offering.

## Three features are waiting on one decision

Faces block agreeing with Scryfall on a two-sided card, oracle text blocks
`o:` and `kw:`, and an illustration group per printing blocks the scanner:
its whole approach is art narrowing to the printings that share one, with the
collector line picking among those. Each asks the same thing — base pair, or
opt-in part — and answering it three times is how a format stops cohering.

Measured 2026-09-20, each built as the file it would be and compressed the way
the CDN compresses:

| candidate | rows | raw | brotli | on a 4.01MB base |
|---|---|---|---|---|
| faces, the fields the rules read | 3,295 cards | 0.67MB | 0.10MB | +2.5% |
| illustration group | 108,883 printings | 0.63MB | 0.04MB | +1.0% |
| keywords | 37,821 cards | 0.35MB | 0.05MB | +1.2% |
| oracle text | 37,821 cards | 5.70MB | 0.57MB | +14% |

**The estimate for text was three times too pessimistic** — 0.57MB against
the 1.5MB guessed at before anyone built the file. Oracle text is the most
repetitive thing we ship and brotli eats it. The table above is the corrected
version.

**Faces, illustration groups and keywords earn the base pair.** Together they
are 0.19MB, which puts the download at 4.20MB and leaves the 4-5MB target
alone. None of them is a feature someone might not want: without faces a
two-sided card answers no question about its colors or its types, and without
a group number an art match names a card where a scanner needs a printing.
Only 3,295 cards have faces at all, which is why the dominant class of
divergence costs a tenth of a megabyte to close.

**Oracle text stays opt-in**, being a seventh of the base for two features
that a collection tracker does not need. Cheap enough now that the question is
worth revisiting if a third feature ever wants it.

**Bytes are the cheap part.** Only the group number needs the cache to change:
`illustration_id` is parsed nowhere today, so it wants a column, a migration
and a line in the sync. Faces and keywords are already held. The work that
matters is in the client, where a term has to be satisfied by a card or by any
one of its faces — a change to how the tree is walked, not a column to read.

**Settle it before the scanner index exists, not after.** That artifact is
gigabytes pulled at a throttle and hours of hashing, and what it keys on is
the printings an illustration group names. Deciding first costs nothing;
deciding after costs the rebuild.

### None of it scales the same way with language

Those figures are measured against the cache, which holds Default Cards and
is therefore 97.6% English. What each one does when every language arrives is
not the same answer, and Scryfall's own counts on 2026-09-20 say which:

| | English | every language | ratio |
|---|---|---|---|
| paper printings | 98,578 | 521,724 | 5.3× |
| distinct cards | 32,992 | ~33,000 | 1× |
| distinct artworks | 48,478 | 48,478 | 1× |

**Cards and artworks do not scale, printings do.** A Japanese printing is
another printing of a card we already hold, sharing its art; Japanese covers
30,567 of the 32,992 cards. So the cards file stays the size it is, the
illustration index stays the size it is, and only the prints file multiplies —
2.73MB becoming something near 14MB, which no budget survives.

**The scanner does not need them anyway.** What it reads off a card is the
art, the set code, the collector number and the language glyph, and those
three together name a printing outright. Turning that name into an id is one
call to Scryfall, which is already how a non-English printing is resolved
today and already cached per device. A thousand scanned Japanese cards is a
hundred seconds of that, once, against fourteen megabytes every user would
carry whether or not they own a single one.

**So a language pack, and the useful one is printings rather than text.** Each
major language runs 15,000 to 62,000 paper printings, so Japanese comes to
roughly 1.7MB — worth choosing when a collection is substantially in one
language, and worth nothing to anyone else. Text scales by card instead, so a
pack per language is near the English 0.57MB whatever the language, and all of
them at once would be some eight megabytes of text in languages its reader
cannot read. Per language, opt-in, both of them.

Either pack has to be built from All Cards, which is unrelated to this
decision and wanted anyway — see below.

**Settled: names for every language ride in the base, text and scanning do
not.** A name is 26 bytes and eight languages of them come to 6.3MB, less than
English text alone, and they are what a scanner has to read on a card printed
before collector numbers existed. Text and the scan index are packs, one per
language, chosen at onboarding from the app's own language and added to by
anyone who wants another.

## Open questions

**Trade quantity.** Two of the trackers we import from carry one. A trade list
is the better model, but the column has nowhere to land, so import and export
both need a defined mapping rather than silent loss. See the comparison above.

**Repeated tokens.** Tokens from different sets carry different oracle ids,
so grouping doesn't collapse them: searching "goblin" still returns five rows
of Goblin token. Grouping them wants a key that isn't `oracle_id` — name plus
type plus power and toughness, probably — and that's guesswork until someone
complains.

## References

- [Scryfall API docs](https://scryfall.com/docs/api) — data/image use rules
- [Scryfall bulk data](https://scryfall.com/docs/api/bulk-data)
- [Scryfall migrations](https://api.scryfall.com/migrations) — retired and
  merged printing ids
- [MTG Wiki: information below the text box](https://mtg.wiki/page/Information_below_the_text_box)
  — premium indicator, set code, collector number layout
