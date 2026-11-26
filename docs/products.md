# Sealed products

What a pack, box or precon holds, and which of them a card can be found in.
Scryfall answers neither: a card object carries `booster: bool` and stops, and
there is no product object at all.

MTGJSON does, and it is the only feed that does. Figures below are measured
against build `5.3.0+20261126`, the booster ones against `5.3.0+20261119`, and
both against a cache synced from the Default Cards of 2026-11-16.

## What it carries

`SealedProduct` hangs off every set, and off every entry of `SetList` — so the
whole catalog is one small file rather than a slice of a large one. ~4,400
products across 353 set codes, reaching back to the 1990s.

`contents` is a union of seven arrays, and
**which one a product has decides
whether the answer is a fact or a probability**:

| kind       | products | holds                               | answer |
| ---------- | -------: | ----------------------------------- | ------ |
| `deck`     |    2,228 | a named decklist in `setDecks`      | exact  |
| `sealed`   |    2,012 | `count` of another product          | exact  |
| `pack`     |    1,188 | a booster config name               | chance |
| `other`    |      874 | a name only — spindowns, storage    | none   |
| `card`     |      495 | a named printing, by set and number | exact  |
| `variable` |       74 | configs that differ between copies  | chance |

Only `sealed` carries a count. Everywhere else an entry is one of the thing,
and a box of 36 packs is a `sealed` naming the pack product rather than 36
rows.

The seventh is `variable_config`, which appears only inside a config and
**holds nothing the list of configs does not**: no variable in the corpus
weights its configs unevenly, and where a weight is written at all it is the
number of configs, against a `chance` of 1. So a Welcome Deck's 330 configs are
330 equal possibilities, and reading them as a plain list is right.

A product may carry several. `sealed` recurses — a booster box is 36 of a pack
— so it bottoms out in whichever kind the thing it names has. So does
`variable`: a config is a whole `contents`, nested configs and all.

**A booster is a weighted model, not a list.** A set's `booster` object is
keyed by config name, each config a weighted choice of layout over weighted
sheets. Bloomburrow's collector config draws from three sets across eight
sheets. Nothing about it says a pack _contains_ a card, only that it can.

`Card.sourceProducts` looks like the index this subject wants and is not: it is
every product whose sheets a card sits on, so a common's foil list runs to
twenty products it will almost never be in. Exact for `card` and `deck`
contents, a could-contain elsewhere. **Shown as a fact it is a lie**, which is
the one thing to get right before any of this reaches a screen.

## The join

**Exact card contents need nothing new.** `SealedProductCard` carries `set` and
`number`, and the cache already has `cards_printing` unique over
`(set_code, collector_number, lang)`. Measured: **every entry resolves**, each
to exactly one printing, and all but ~50 products sit in sets the cache holds.
Those are Mystery Booster and a handful of older promo sets.

**A set code arrives spelled two ways.** The tables carry it upper case and the
JSON inside their columns carries it lower, so a product's contents joins
neither the booster tables nor `setDecks` untouched. The cache spells it lower,
which settles which way to fold.

**Join on the pair and leave `lang` out of it.** The index invites pinning it
to `en`, which silently drops a printing Default Cards holds in one other
language alone — Phyrexian `one` #283 and `pmei` #2023-1 are two of these 590.
Without it the pair is still unique, over all 119,509 in the cache.

**Decklists need the uuid map, and that is where the volume is.** Every board
keys by MTGJSON's own uuid and nothing else, so reaching them means
`cardIdentifiers`, which is 16.2MB of the 19.4MB this subject costs. It buys
**115,756 entries across 3,164 decklists**, against 639 from exact card
contents — so the map is not a saving to defer, it is 99.5% of the feature.
Every one of those entries resolves, 563 of them through `tokenIdentifiers` and
the rest through `cardIdentifiers`.

Seven boards, not one: `mainBoard` is 113,455 of those entries and the rest sit
in `sideBoard`, `commander`, `displayCommander`, `tokens`, `planes` and
`schemes`. Nor is a mainboard a given — five decklists are token sheets and
have none.

**A decklist is named, not coded.** `code` repeats, 268 lists sharing one with
another, while `(setCode, name)` is unique over all 3,164 — and the name is
what a product's `deck` contents gives, so the pair is the key either way. The
reverse list, `sealedProductUuids`, names no product the contents does not: 268
pairs run the other way alone, so the join is worth holding once, from the
product's side.

**A `tokens` board can name the same card twice**, forty times over and nowhere
else, the two rows carrying counts of their own. Nothing says whether that is
four cats or three, so the counts are summed and the merge is reported.

690 of the entries sit on a printing the catalog exports no position for, which
is the digital rule the pool already meets. No product's exact contents names
one, so that count is a decklist's alone.

A uuid names a **part**, not a printing, so the map is many-to-one and wants
deduplicating on the Scryfall id rather than counted. Every printing on a
multi-part layout is affected and no printing of any other is: 2,440 of them,
over `transform`, `modal_dfc`, `adventure`, `split`, `prepare`,
`reversible_card` and `flip`, reaching five uuids for the five-part
`Who // What // When // Where // Why`.

No sheet needs that table: every uuid in the pool is keyed in
`cardIdentifiers`, so a booster resolves whole without fetching it.

**Tokens are keyed in a table of their own.** `cardIdentifiers` has no row for
one, so a `tokens` board resolves nowhere without `tokenIdentifiers` — and
neither do 17 `mainBoard` entries, which are the Theros challenge decks, whose
oversized cards MTGJSON files as tokens. 563 entries in all, closed by 924KB.

An entry can also carry `not_in_mtgjson` where an id belongs: 24 of them in the
build of three weeks earlier and none in this one, so a reader takes it as
absent rather than failing on it.

## What a pack can be shown as

The odds are not all the booster tables hold, and the rest of it is structure.
`setBoosterContents` gives the picks each layout variant takes from each sheet,
so the count printed on a wrapper falls out of the data instead of being
transcribed off one. Bloomburrow's play booster has four variants, differing in
two places:

| sheet                    | picks |
| ------------------------ | ----: |
| `common`                 |   6-7 |
| `uncommon`               |     3 |
| `rareMythicWithShowcase` |     1 |
| `wildcard`               |     1 |
| `foil`                   |     1 |
| `land` or `foilLand`     |     1 |
| `specialGuest`           |   0-1 |

A Special Guest takes a common's slot, which is why that row is a range, and
the land is foil or it is not. Neither statement needs a probability behind it.

**The pulls are `setBoosterSheetCards`** — 300,657 rows naming 79,807 distinct
cards over 4,583 sheets, for the 206 sets carrying booster data at all. Held as
positions into the catalog, grouped by sheet with the positions delta-coded, it
is 2.23MB and compresses to 550KB — small enough to go to every client rather
than be a part they opt into. Plain text beat a varint encoding of the same
rows, gzip making more of repeated digits than of packed bytes.

**This side of the join is one-to-one**, which the decklist boards are not. All
79,807 resolve, to exactly 79,807 printings, though 2,002 of them sit on a
printing that has several uuids: a sheet names the whole card where a board
names a part. So the pool needs no deduplicating, and a second uuid arriving
against a printing already placed is a change in the feed rather than the
multi-part case.

**What the catalog drops is digital, every row of it.** Each uuid in the pool
reaches a printing, and ~7,500 of those rows reach one the cache exports no
position for, which is what it does with a digital printing. Sixteen
configurations lose their whole pool that way — `akr`, `pio`, `sir`, the
Masters Editions, the rest of the MTGO and Arena sets — and two named `arena`
inside paper sets lose nearly all of theirs. What remains is `mbc`'s draft
config, three cards short of its 2,527. So the rule a refresh wants is not a
share of the whole: drop a configuration with no paper in it, and refuse one
that loses cards it cannot account for.

**The weights do not fit 32 bits**, being scaled to a common denominator rather
than counted. `mh3`'s wildcard sheet totals 1,509,042,889,200 and 1,750 pull
rows across eight sheets pass the same mark, so a narrow column truncates most
of the corpus silently or refuses the row.

**A weight is a denominator shared out, not a count.** `fin`'s play wildcard
sheet totals 177,008,370,000,000 over 395 cards, and those cards carry twelve
distinct weights between them — a dozen ordinary fractions, 1 in 115 to 1 in
13,174, written over one number big enough to hold them all at once. Reduce a
card's weight against its sheet and the fraction comes back small: nothing in
the corpus needs a numerator past 3,626,733 or a denominator past
3,006,380,000, and the 300,657 pull rows carry 2,046 distinct rates in all. A
per-sheet divisor is no help, 4,563 of the 4,583 sheets being coprime already,
and every sheet's total was checked to be its cards' weights summed.

**64 bits is wide enough to hold a weight and not to multiply two.** A config's
total against a sheet's reaches 221,260,462,500,000,000,000,000, which a `u64`
passes twelve thousand times over, and a pack drawing on three of `fin`'s
sheets at once wants a further nine digits. So odds are not the feed's integers
multiplied together: reduce each rate first, where it is small enough to be
dull, or carry it as a float, every value here sitting well inside what one
holds exactly. The parsed columns stay as given — that layer owes the feed
fidelity rather than arithmetic — and the reduction belongs where the index is
built. 2,046 rates is also a table in the header and a code per row, which is
what the catalog does with every other low-cardinality column.

The weights exist and are exact, per variant and per card on a sheet. Leaving
them off a screen is a decision about what a reader can act on rather than a
gap in what we hold: every card a configuration draws from, listed under the
counts above, answers what a pack might hold without asserting what it will.

Sheet names belong to the set that defined them rather than to a fixed list.
Recent sets name a sheet for the slot it fills; a draft set from 2003 names
four of them after colors, so what reads as one line of commons elsewhere
arrives there as four.

## Where it shows

A product is not part of a set the way a card is: one published under a set
code can hold cards printed elsewhere, which is what `sourceSetCodes` records,
and a configuration can draw across several sets at once. So products browse
beside cards and sets rather than inside one, and what a product holds is a
list in its own right instead of a filter over the set it was published under.

**Both directions are wanted, and they are one index read two ways.** A sheet
row names a card and a product at once, so opening a product to ask what could
come out of it and opening a card to ask where it can be got cost the same
table.

**The card's own view is two lists, never one.** A fixed printing in a bundle
and a one-in-thousands pull from a collector booster are different kinds of
claim, and running them together is the lie warned of above. Exact contents
first, plainly; sheet draws second, each carrying the odds that put it there.

**Completion is that pool against the collection.** Nothing new comes out of a
set's play boosters once every card their sheets draw from is already held. The
holdings answer it with no further table, and it belongs to a configuration
rather than to a product, a box inheriting whatever its pack is.

## What this costs to run

Per-table CSV, not the whole dump: `AllPrintings.json.gz` is 183.9MB and
nothing here needs it.

| table                         | on the wire |
| ----------------------------- | ----------: |
| `cardIdentifiers`             |     16.2 MB |
| `setBoosterSheetCards`        |      4.3 MB |
| `setDecks`                    |      1.9 MB |
| `tokenIdentifiers`            |      924 KB |
| `sealedProducts`              |      417 KB |
| the other three `setBooster*` |       98 KB |

23.8MB a week in all. Builds land daily, there are no deltas, and every file
has a `.sha256` sidecar — so the check is a few hundred bytes and pulls only on
change, which for sealed data is far less often than daily. Against the 78MB of
Default Cards each week this does not compete.

Parquet sits at the same per-file addresses, serves byte ranges, and comes to
18.7MB for the same seven. Most of the gap is `setBoosterSheetCards`, 2.1
against 4.3, a column of uuids being what a column format is good at. The
saving worth having is narrower: reading `cardIdentifiers` as two columns
rather than every external id it carries. Both want a reader doing range
arithmetic, against a weekly figure nothing is straining at.

**Refresh after the Scryfall sync, never before.** The join resolves against
the cache, so a product for a set the cache has not taken yet drops its rows
without saying so. An export that loses more than a trivial share should refuse
rather than publish a product holding half its contents.

## Licensing

MTGJSON is MIT, holding only that the copyright and permission notice travel
with substantial portions — which puts it beside the existing attributions
rather than anywhere new. Read <https://mtgjson.com/license/>; note the text
grants rights over "this software" and the site applies it to the data, a
looseness worth knowing about rather than relying on.

Two things it cannot convey, both in [`ip.md`](ip.md):

- **Wizards' rights flow through unchanged.** Product names are theirs on the
  same footing as card names, whoever hands them to us.
- **Prices are somebody else's commercial feed.** MTGJSON republishes
  Cardmarket and TCGplayer figures under terms it does not hold, so the price
  files are a separate decision from this one and are not taken here. Sealed
  and booster data is MTGJSON's own curation and carries none of that.

Reaching MTGJSON's card columns is reaching Scryfall's data by another route,
so it is no laundering step for anything Scryfall's terms already govern.

## Open

- **Totality.** Three sets were checked card-for-card, not the whole corpus.
  Count before anything depends on every printing being present.
- **The order a product's contents read in**, once one product recurses into
  another and a decklist runs to a hundred cards. The feed's own key order is
  lost in parsing, so what is held is the order the arms are read in.
- **Whether a token named twice is two of it.** Forty entries do, and the
  counts are summed on the reading that each row is a count of cards. The other
  reading is one token listed once per card that makes it.
- **What a chance reads as**, as a sentence rather than as arithmetic. The
  numbers are settled above; what a reader does with 1 in 13,174 is not, and a
  balanced sheet makes it an approximation anyway.
