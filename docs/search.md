# Search and filtering

What the client answers on its own, over the artifact in
[`scryfall.md`](scryfall.md). Nothing here reaches a server: the catalog is on
the device, so the only limit is which parts of it someone chose to hold.

## What manual search surfaces

Filtering was the wrong first instinct: almost everything is a real card
someone can own. Only digital printings can't be, which makes them a category
error rather than a preference, so they are excluded outright and no toggle
reaches them. Un-sets, special editions and oversized cards stay searchable —
Unfinity acorn cards are Legacy-legal, and someone with a 30th Anniversary Mox
searching and finding nothing is a worse failure than a noisy result.

The noise was mostly a grouping problem. Paper alone runs to six figures of
printings across tens of thousands of cards, so "Forest" returned hundreds of
rows. One row per card, with a count, and a representative printing chosen by
preferring booster printings from expansions and core sets, then nonfoil over
a foil-only twin sharing its
collector number. The order is total, ending in the printing id — the files
are named after their own bytes, so a tie left to SQLite would rename them for
nothing.

| | cards | printings | rank |
|---|---|---|---|
| cards | 34,503 | 103,309 | first |
| tokens, emblems | 1,090 | 3,295 | second |
| art series | 2,243 | 2,650 | third |

Art series carry their own `oracle_id`, so grouping alone would leave them
competing with the card they depict — hence the tier. An exact name match
still beats the tier, because someone typing a token's name means the token.

Tokens and art series each have a toggle, and so does grouping, all on by
default. The extras are 8.8% of card rows and 5.4% of printings, so they are
cheap enough to ship and hide rather than fetch on demand — the toggles work
offline.

## Ranking

Searching the artifact is a scan of 37,000 names costing a few milliseconds,
so the client builds no index. It ranks on exact match, then names where the
query starts a word, then anywhere at all; within a tier, the printing tiers
above, then popularity.

A whole-name prefix is deliberately *not* its own tier, or "bolt" fills on
Bolt Bend and Bolt Hound and never reaches the card anyone meant.

**Popularity is EDHREC rank, and reprint count where there is no rank.** 15%
of cards carry no rank — every token and art series, and the basic lands — so
an unranked card is scored as if its rank were `worst / printings`. Both
halves were needed: ranking the unranked last puts Karplusan Forest (#222)
above Forest, and dropping the rank puts Aladdin's Ring (#24,725) above The One
Ring (#91).

Being an EDH signal, it misjudges cards that format never sees: the Power Nine
rank nowhere, so "mox" leads with Chrome Mox and Mox Amber rather than Mox
Emerald. Acceptable for now — the honest fix is our own signal, below.

## Browsing, sorting and filtering

Filtering and sorting are built, as the query language below rather than a UI
of their own. **The artifact already carried everything they need** — type
line, colors, color identity, mana cost, cmc, power and toughness, rarity,
set, artist and layout — so neither was a format change.

**Two places list cards, and they ask the same question differently.** A
search ranks names across the whole catalog and shows one row per card; a set
shows every printing it holds in collector order, and a term narrows that pile
rather than searching it. The same parsed query drives both, so a filter means
one thing in either.

Still wanted: **a grid view** with the cell size or column count settable,
since a wall of card images is how everyone else presents a collection and the
image URLs derive from the print id.

### Grouping, and a card page

Search groups by card. Two other modes are wanted and only one of them is
free:

- **Ungrouped**, a row per printing, is a walk of the runs already built.
- **By card** is what it does now.
- **By art** groups on the art column the printings file already carries, a
  dense group number rather than an id: nothing needs to *name* an
  illustration, only to know which printings share one. The client reads past
  that column today.

A card page wants the larger art, every printing, and the full details. All of
that is in the artifact except oracle text, which is the opt-in part above:
images derive from the print id and the printings are the run.

**A row's art and its name lead to different places.** The art opens the art
at full size, the name opens the details — the same split on a card page as in
a result row, so the gesture means one thing everywhere.

**Neither list pages.** An empty search box shows the sets rather than paging
blindly through every card, and a set's printings — several thousand for
The List — scroll inside a bounded box. `content-visibility: auto` leaves rows
past the fold unlaid-out until they approach it, which is what makes that many
rows cheap without a windowing library; `contain-intrinsic-size` keeps the
scrollbar honest until each is measured.

**Our own popularity signal replaces EDHREC's** once Explore exists (Phase 3):
how many copies the network holds, and how many decks play a card, are both
things we would then know first-hand — computed from indexed records rather
than borrowed, covering the formats EDHREC doesn't, and the same input the
recommendations in [`roadmap.md`](roadmap.md) want.

## A query language, borrowed

Don't invent one. **Scryfall's syntax already is one**, every player knows it,
it is documented, and a query written in it means something outside this app —
which is what makes a shared search worth sharing. Checked against their docs:

| to ask | Scryfall says |
|---|---|
| red-green cards | `c:rg` |
| at least white and blue, but not red | `color>=uw -c:red` |
| instants an Esper commander can play | `id<=esper t:instant` |
| exactly two colors | `c=2` |
| more than three generic, one white, one blue | `m>3WU` |
| mana value five | `mv=5` |
| eight or more power | `pow>=8` |
| creatures that are top-heavy | `pow>tou` |
| ever printed in Russian | `in:ru` |

**The mana operator is already the interesting one.** A cost is *greater* than
another when it holds all the same symbols and more, and *less* when it holds
only a subset — so `m>3WU` is a subset relation rather than a numeric one,
which is exactly what "at least this much red" needs and what a per-color
number can't express.

**The color modes are operators, except the one that isn't.** ManaBox offers
four buttons — exact, inclusive, maximum, and Commander identity — and they are
`c=`, `c>=`, `c<=` and `id<=`. **"Any of" is the fourth question and has no
operator at all**: white *or* blue is `c:w or c:u`, which is why grouping had
to exist before the pips could offer it. So the controls and the query say the
same thing twice, which is what makes prefilling work rather than being a
trick: **the query string is the state and the controls are a view over it**,
either one editing it. A control reads the comparison back as well as the
value, or pressing a pip on a `c<=wu` query would quietly widen it.

**Two controls can share a key where the values can't be confused.** The pips
name colors and the count is a number, so ManaBox's slider and its pips are one
key and two terms, each rewriting only the shape it owns — which is what makes
counting a control rather than something only the box can say. That slider is
dual, and a range is a third thing again: two comparisons of the same key,
`c>=2 c<=4`, so the comparison belongs to the term rather than to the key.
Two selects rather than a slider, there being no such input and a phone
handling a menu better than two overlapping thumbs. The same
reading tells the three type controls apart: `t:legendary t:creature t:goblin`
is one run of terms, and which control holds which word is read off the word,
supertypes and types being closed sets and everything after the em dash being
the rest.

**Subtypes usually mean "any of", where a supertype and a type mean "and".**
Goblin or Elf is a real question and legendary-and-creature is the only
reading of two, so the choice sits on the subtypes alone rather than on all
three. The vocabulary is scanned out of the type lines at first use: ~600
words the artifact already ships, for no new column. Splitting a type line on
its spaces makes two entries of Time Lord, the one subtype written as two
words — cosmetic, because `t:time` is a substring match and finds it anyway.

**A control reading the wrong term is the failure mode of all of this**, and
it has one cause: a regex that sees a neighbor's term as its own. Four ways it
happened — a comparison read as a value, where `c>=4` fell back to `c>` and
took `=4`; a key inside a word, `is:foil` holding `s:foil`; a spelling the
control doesn't write, so `set:lea` read as no set and picking one wrote a
second term; and a quoted value split on its space. Every one of them was a pattern
guessing at structure the parser already knew.

**So a control edits by span.** The parser records where each term sat — every
term, including the ones it drops from the tree, because `order:mv` filters
nothing and a control still has to find it — and an edit cuts those offsets
and writes the new term. There is no key-matching pattern left to get wrong:
what a value may hold, where a key begins and which spelling was typed are all
the tokenizer's answers rather than a regex's. A group mixing keys, which the
old reading damaged, is now two spans belonging to two controls. What survives
of the string surgery is tidying after a cut — an emptied group, a dangling
`or` — which is small, structural and tested.

A round-trip test holds the invariant: reading a control's state and writing
it straight back asks the same question.

**Refusing a color is the fifth question and needs no fifth control.** `-c:r`
is a term like any other, so a pip carries three states rather than two —
wanted, refused, neither — and each refusal is written alone, `-c:r -c:g`
being neither where a group would ask something else. Counting instead of
naming, `c=2` for two-color cards or `c>=3`, is typed: it wants the same key
as the pips and there is no honest way for both to hold it.

Three things fall out of that:

- **A shared search is a link**, because the query string is the URL. Nothing
  extra to build.
- **A saved search is a named query string** — short, portable, and meaningful
  to other apps because the syntax isn't ours. That is the argument for making
  it a record rather than local state, and it would be a lexicon, so it is not
  a decision yet.
- **An unsupported term is the prompt, not an error.** `o:draw` cannot run
  without the text part, so it says so and offers to fetch it. That is where a
  hint by the search bar earns its place: shown when a query asks for what the
  device doesn't hold, rather than nagging on arrival.

### What runs against the pair today

Everything the artifact carries, which is most of it: `c:` and `id:` with
their comparisons, `mv:`, `m:`, `t:`, `pow:`, `tou:`, `r:`, `s:`, `cn:`, `a:`,
`lang:`, `layout:`, `year:`, the flag predicates as `is:` and `not:`, and
names. Mana pips are parsed out of the cost string, so per-color filtering
needs no new column.

`-` refuses a term, `or` takes either side, and parentheses group — which the
set control needs, because a handful of sets is `(s:lea or s:2ed)` and there
is no other way to write it. A group left open closes at the end rather than
refusing the whole query, since a query is re-read on every keystroke and a
half-typed one is the normal state.

**A term is asked of a printing, because Scryfall's index holds printings and
ours holds cards.** Every term is tested against one printing at a time and a
card answers when one of them satisfies the whole query — so `s:lea r:rare`
wants a single Alpha rare, not an Alpha printing and a rare one. The row then
shows whichever printing answered, which is why searching a set illustrates
the card with that set's art. A set view hands over the one row it is drawing,
so the same query means the same thing in both places.

**`r:` and `in:` are the two questions that split.** `r:rare` asks the
printing under test; `in:rare` asks whether the card was ever printed that
way, whichever printing is being tested. `in:` also takes a set or a language,
and `in:paper` is always true because paper is all the artifact carries.

**`is:commander` is a bit, not a derivation.** A deck is headed by a legendary
creature or a legendary Spacecraft, and by anything whose text says so — 49
cards say it, from the Commander 2014 planeswalkers to Unfinity's spell
commanders, and every one of them means itself. The type half is a rules fact
the exporter carries; the text half is why the bit is computed at export,
where the oracle text is, rather than in a client that never sees it. Which is
the pattern for the rest: a predicate needing text is one flag, not a part.

`order:` takes name, mana value, power, toughness, rarity, release, set,
collector number, printing count or popularity, and `dir:desc` turns it
around. An order sorts everything that matched rather than the page of it that
came back, so it lifts the cap off the scan and puts it on the result.
Ordering by rarity or release reads the representative printing, being the one
the row already shows.

Wanting a part it doesn't have: `o:` needs text, `usd:` needs prices (Phase
2), `f:` needs legality, and `lang:` is only as good as the languages below.
`kw:` wants none of them — keywords ride in the base pair and no term reads
them yet.

**`pow` and `tou` don't fully compare.** They arrive as the `stats` string, and
Tarmogoyf is `*/1+*` — so a numeric filter has to treat a non-numeric power as
unmatched rather than as zero, and say so.

### Held to theirs

`just scryfall-search` puts the same query to their API and to our
catalog and compares the names. Outside `check`, because it needs their
service and answers a question about the implementation rather than about a
commit. It is how "borrow the syntax" stays true rather than becoming
approximately true.

The first run, over eighteen queries, put every divergence in one of three
piles:

- **Faces.** Scryfall matches a face; we hold one row per card. `Kytheon, Hero
  of Akros // Gideon, Battle-Forged` is a one-mana white creature on its front
  and neither to us, and every `A // B` miss is this. Closing it wants face
  data in the artifact — the same column-or-part decision as oracle text, and
  the largest single thing between us and their results.
- **A stale artifact.** `is:commander` found nothing against a catalog built
  before the flag existed. Worth knowing the check catches that.
- **Cards they omit.** Crusade, Imprison, Invoke Prejudice and Jihad are
  withdrawn as offensive and Scryfall leaves them out of search; we return
  them. A divergence to decide on rather than fix by accident.

## Card languages

Three things get conflated, and only the middle one is a setting:

- **App language** — the interface chrome. Ordinary i18n, a separate concern,
  and allowed to lag.
- **Card language** — which name and text to show for a card. A setting, and
  the one that can range over every language Scryfall has.
- **Printing language** — a property of the copy someone owns, pinned by its
  print id.

Nothing about the third reaches a record. `(set, collector number, lang)` is
unique across every printing, which is what `cards::printing_id` looks
up, so a language is a way of *finding* a print id rather than a field beside
one. ManaBox instead makes language an editable property of an entry, bulk
editable — the same fact through a different affordance, and where a CSV import
has to meet us.

The client artifact drops the language, carrying only what Default Cards
holds, and no two of its paper printings share a set and collector
number. So a file exporting neither print ids nor a language still resolves,
which is the whole of what the browser does with a pair. Putting non-English
printings in the artifact would end that, and is one more reason the
translations are a part of their own.

**Which makes this a v0 problem rather than a later one.** Default Cards
carries 652 Japanese printings, 9 German and 5 Russian, so a German collection
exported from ManaBox resolves almost nothing. Import correctness needs the
languages before display ever does.

What it takes, in order:

1. **All Cards** — 392MB compressed, an estimated 590,000 printings from
   Default Cards' 78MB. Streamed and filtered to `lang <> 'en'`, so
   nothing English is stored twice.
2. **A translations table, not a second shredding.** Only what varies by
   language: the printing's own id, its oracle id, lang, set, collector number,
   printed name, printed type line, printed text. Rules, colors and mana value
   are language-invariant and already in `oracle`. Roughly 470,000 rows at ~140
   bytes without printed text and ~290 with, so 65MB against 135MB — the text
   is the expensive half, and the reason it is opt-in separately.
3. **A `names` part per language**, one localized name per card at ~300KB
   brotli, because searching in a language needs every name at once. A specific
   printing's printed name resolves on demand from the API instead, being
   needed only for copies someone owns.
4. **English stays a fallback.** ManaBox's detail and the right one: search
   matches both, so choosing French doesn't stop someone typing an English
   name.
5. **`lang:` and `in:` then answer**, which is the operator table above.

### Which language a name is read in

The language a printing is *in* and the language someone *reads* are different
questions. Someone collecting Japanese cards may still want to read English,
and nobody reads Phyrexian — Quenya's printed names are nine Private Use Area
codepoints no font on the device has, so they render as nothing at all.

So a name is read in the **app's** language, falling back to the oracle name,
which Scryfall keeps in English whatever the printing is. The fallback is
always there: every card in the paper artifact has an English printing.

**The indicator compares the printing to the name shown, not to the
preference.** Reading English over a Japanese printing shows `ja`, because
they differ. Reading Japanese over an English printing shows nothing, because
the name displayed is the English one either way — comparing against the
preference instead would tag almost every row for anyone not reading English.

That makes two settings once there is a page for them: the app's language, and
a card language defaulting to it. Separable on purpose, because the app in
English with cards in Japanese is a real preference and so is the reverse.

## What we still answer differently

Measured 2026-09-22 with `check-scryfall-search`, which puts the same query to
both. Before faces, eleven of its queries were missing results and every
missing card was two-sided; after, one query is, and four cards.

**`pow>tou` compares across the two sides.** Wolfbitten Captive is 1/1 on the
front and 2/2 on the back, so neither side has more power than toughness, and
Scryfall returns it anyway. All four remaining cards fit one side's power
being compared against the other's toughness. That reading is a guess from
four cards rather than anything documented, so it is written down rather than
implemented.

**We return cards their default search hides.** Ten of the eleven remaining
disagreements are ours returning more, never less, and the extras are
`set_type` of `funny`, Mystery Booster playtest cards, and the handful
Scryfall delisted for their content. Their search excludes all three unless
asked; ours has no notion of it. That is a filter we do not have rather than
data we lack, and it is the larger of the two gaps left.

## Where the choices live

A settings page owns the card language and which parts are held, and onboarding
asks the same two questions once — see [`data-model.md`](data-model.md). The
hints by the search bar are the third surface and the only one that appears
uninvited, so they are tied to a query that asked for something missing rather
than shown on a timer.

## References

- [Scryfall search syntax](https://scryfall.com/docs/syntax)
- [ManaBox search FAQ](https://www.manabox.app/guides/search/faq/)
