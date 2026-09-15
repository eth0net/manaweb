# Data model

How owned cards, containers and designs relate, and what the interface makes
of them. Schemas live in [`lexicons/`](../lexicons/README.md); this is the
reasoning behind their shape.

Everything hangs off one question: do these cards physically exist in your
possession, or are they a reference?

- **Container** — a named physical place: binder, box, deck box. A record with
  a name and a kind.
- **Collection entry** — a card you own, in exactly one container. Carries
  `scryfall_id`, finish, condition, quantity.
- **Design** — card references you may or may not own. A *deck* is a design
  with deck metadata (format, commander, sideboard); a *list* is one without
  (wishlist, trade pile). Same entry shape, different parent.

"Design vs built" for decks and "collection vs list" for cards are one axis
asked twice, so they share a mechanism rather than becoming four concepts.

**"Built" is derived, never stored.** A deck is built to the extent its design
entries are matched by collection entries in that deck's container. Partial
builds come free, the gap is both a shopping list and a valuation, and
conflicts surface on their own: if two decks want your only Sol Ring, the card
is in one container and the gap shows it. A stored flag would drift the moment
you rob a deck for parts.

**Cards in a deck box are still yours.** Owned valuation sums collection
entries wherever they live. Moving a card changes its container, not ownership.

Consequences:

- One record per collection stack, deck contents embedded as an array in the
  deck record. A 10k-card collection can't be one record; a 100-card deck
  shouldn't be 100.
- Design entries: `oracle_id` required, `scryfall_id` and `finish` optional.
  Omitting the print means "any printing". Carrying both ids keeps the record
  interpretable without a Scryfall index, which matters for a record other
  AppViews may read.
- **Design entries are keyed `(oracle_id, scryfall_id?, finish?)`**, so diffs
  and fork provenance have stable identity rather than array positions. The key
  also handles two entries for one card intended as different printings.
- **Owned cards are keyed differently**: `(scryfall_id, finish, condition)`
  within a container. No `language`: every language of a printing has its own
  Scryfall id (m10 #146 has nine), so the field could only contradict it.
- The keys share no fields, and owned cards carry no `oracle_id`, so matching a
  design entry to owned cards routes through the card cache to resolve
  `scryfall_id → oracle_id`. That join is the heart of the design-vs-built
  diff, and it isn't free.
- **A proxy is flagged; every other physical oddity is a tag.** A proxy is the
  one that behaves differently — it fills a deck slot but counts toward no
  valuation. `altered`, `misprint` and `signed` only affect what a copy is
  worth, which we never compute per copy since Scryfall prices the printing,
  so tags are a permanent enough home. Borrowed cards are a note.

## Interface — one model, separate views

The model makes decks, binders and lists the same thing. The UI should hide it.

- **Collection view** answers "where is my Sol Ring?" — every copy owned,
  grouped by container, naming the deck where the container is a deck box.
  That's why a deck references its container.
- **Deck view** shows only designs carrying deck metadata; lists get their own
  view. Filtering on kind is the entire mechanism.
- **Filters survive navigation.** Opening a set or a card and coming back
  keeps what was typed, so view state lives above the view using it rather
  than inside it.
- **One app for phone and desktop**, not two designs and not a desktop layout
  that shrinks. Every layout decision is made for both at once.
- Containers are an **opt-in organizational layer**. Default to a single
  "Collection" so someone who doesn't care where a card lives never has to
  answer. Location tracking for those who want it, not a tax on those who
  don't.

### Where things live

Four tabs, and a fifth once there is anything social to put in it:

    Cards · Collection · Decks · Lists    (· Feed, from Phase 3)

Five is the ceiling, and what keeps it there is that **a tab is an object
type, while segments say whose something is and what it is for**. Decks and
Lists each carry Mine and Saved, `purpose` segments a list further, and Feed
carries Following and Everyone, which is where exploring other people's decks
lives. Whether you wrote a deck is a filter, not a different place to look.

Containers are a drill-down inside Collection rather than a peer of it, and a
deck is one inside Decks: depth belongs to the view, breadth to the bar.
Following happens on a profile, the roster sits in yours, and the feed is what
it produces, so none of that is a destination either. Profile, settings and app
news live in the account control.

**Scan is an action, not a place.** It is scoped by wherever it is pressed —
into this container, into this deck — and in Cards it is a camera in the search
field, scanning and typing being one intent by two inputs.

Routes settle before the bar does, because a shared deck link outlives any
arrangement of tabs. `/cards`, `/collection/:container`, `/decks/:deck` and
`/lists/:list` are the commitment; their order along the bottom is not.

**The bar is a bar only where a thumb reaches it.** On a laptop the same four
destinations stand up as a rail down the left, in the same order: one
arrangement in two shapes, not a second navigation. What sits beside it keeps a
reading measure rather than filling the window, so what the rest of a desktop's
width becomes — a second column of cards, a detail pane — waits until a narrow
one proves not to be enough.

### What following and saving still need

Neither has a lexicon, and both are Phase 3.

**A follow of ours, not Bluesky's.** The OAuth grant is `repo:app.manaweb.*`
and nothing more, so writing `app.bsky.graph.follow` would mean asking for
Bluesky access again — see [`atproto.md`](atproto.md). It is the right answer
socially too, since following someone for their decks should not follow them
anywhere else. Reading that graph to seed suggestions costs nothing.

**One save record covering both.** A save points at something to find again; a
fork copies something to edit, which `forkedFrom` already carries. One
collection rather than two, because each one is another `repo:` scope on the
consent screen.

### Counts and value

Three numbers rather than one with a toggle, because they answer different
questions:

- **Owned** — every collection entry, summed. Cards in a deck box count: a
  deck box is a container, and what sits in it is still yours.
- **Design** — a design's entries priced at the printing they name, or at the
  cheapest where they name none. What it would cost to own, and what a
  wishlist is worth.
- **Gap** — design minus owned, straight out of the diff below. A shopping
  list with a price on it.

A deck shows all three, a list has no owned number, a container has only one.

Nothing double counts, because a design holds references and only a collection
entry is ownership. So Collection is not a place that decks sit outside of: it
is the total, and containers are its breakdown, a deck box named for the deck
it holds. ManaBox needs a toggle here because presence in a deck is a flag on
its cards rather than where they sit.

Proxies fill a slot and are worth nothing, so a deck's build and its value
disagree deliberately.


### Editing a stack

A stack is identified by everything the record says about those copies in
particular — printing, finish, grade, place, whether they are proxies, their
tags and their note. Regrading a card or moving it is therefore a change of
identity rather than a field edit, and where the amended stack matches one that
already exists the two become one record: two entries claiming the same
identity would each be a partial answer to "how many". A signed copy and a
plain one at the same grade stay two stacks, being two different things.

Quantity and the timestamps are the only fields outside identity, and
acquisitions the one thing that combines: they are what the copies cost, so
they join rather than one side being picked. A merge past a ceiling the lexicon
sets is not made at all, leaving two stacks where one would have done and
losing nothing. A stack taken to zero is deleted, never kept at zero.

Tags are a set, written sorted and deduplicated and read without relying on
either, since another client's records arrive however that client wrote them.
Acquisitions are written in date order, undated lots first and keeping the
order they arrived in: a merge concatenates two histories, so anything else
would order a stack's past by which container was emptied first. Which side's
undated lots lead is still the concatenation's doing, and no field in the
record can settle it.

Deleting a container unfiles what it held. A container names a place and not
ownership, so losing the place cannot lose the cards — they go back to the
unfiled pile, merging into whatever stack is already there.


### Signed out, signed in, and on this device only

Three states, because reading needs no account and only writing needs
somewhere to write. The catalog is client-side and public, so signed out
already gets card search, printing comparison and a legality check against a
pasted list, with no OAuth flow to get through first.

- **Signed out** is the front page plus that search, and a scratch pad.
  Nothing persists, and the interface says so rather than quietly
  accumulating.
- **Signed in** is the dashboard: your collection, your decks.
- **On this device only** is the deliberate third choice in
  [`atproto.md`](atproto.md) — no PDS, no sync, an export nag, and the honest
  answer for someone who doesn't want a world-readable inventory.

**The failure to design against is the first quietly becoming the third**:
someone imports ten thousand cards without signing in, clears site data, and
loses all of it having never chosen to.

Until the third choice exists, import refuses outright while signed out: there
is nothing to write to, and a tab's storage is not an answer anyone chose.
Marked `todo(local)` at the gate.

So **import is where you ask**, which is where the sharing warning has to go
anyway. Search and scratch freely; the moment data arrives in volume, ask
where it lives.

**Onboarding asks two more things**: which language to show cards in, and how
much of the catalog to keep on this device. Both are display choices that
reach no record — a print id already pins its language — so either can change
later without migrating anything. A settings page owns them afterward. What
the parts cost is in [`scryfall.md`](scryfall.md); the three senses of
"language", and why import needs them before display does, are in
[`search.md`](search.md).

Public activity while signed out — Tangled's front page — needs Explore, so
that slot stays empty until Phase 3.

### Deck state

`archived` is the only stored state — GitHub-style, drops a deck out of the
default list, reversible. "I've stopped caring about this" isn't derivable from
anything else.

Everything else is observation on two independent axes: **design completeness**
(entries against the format's target) and **build completeness** (how much of
the design you have).

Build completeness is **scoped by whether the deck has a container**, which
needs no setting of its own:

- **With a container** it asks "is this deck built?" — how much of the design
  is physically in that deck box. Precise, and it makes competing decks
  visible, since a card lives in one container.
- **Without one** it asks "could I build this?" — do you own enough copies
  anywhere. That's the answer for anyone who never opted into container
  tracking, and it's the same question ManaBox answers.

The trade is that ownership scope loses conflict detection: own one Sol Ring
and two decks both read as satisfied, because nothing allocates it. Acceptable,
and the same trade every collection tracker makes. The four diff states below
work either way — only the candidate pool changes.

"WIP" is a label the UI puts on a range of those numbers, not a state anyone
sets. A half-designed deck with nothing sleeved is (78%, 0%); a finished design
you haven't built is (100%, 0%).

### Design vs built diff

The intended-print-versus-reality view is a feature in itself: you designed
around a Necron Darkness, you have an ordinary one sleeved, and the app should
say so rather than calling the slot filled. Per design entry:

- **Satisfied** — intended print and finish present.
- **Print mismatch** — right card, wrong printing. The upgrade list.
- **Finish mismatch** — right print, nonfoil standing in for foil.
- **Missing** — nothing fills the slot. The buy list.

Plus **extras**: cards in the container that aren't in the design.

Missing plus mismatches *is* the shopping list, so a per-deck wishlist needs no
maintaining. Only entries with a deliberate print intent can mismatch, which is
what keeps "any printing" designs quiet.

### An import lands whole, then becomes cards

A CSV is consumed into `app.manaweb.import` parts in a few seconds, and those
parts drain into `app.manaweb.card` records over the hours the write budget
takes. The upload is therefore finished the moment it is accepted, which is the
only part a person is waiting on, and the plan stops being state on one device.

**A part is sized by the transaction that drains it, not by bytes.** Draining
is one `applyWrites` holding the part's creates plus a delete of the part
itself, and that call caps at 200 writes — so a part holds at most 199 entries,
and the writer packs fewer when the entries are large. Bytes bind first only
for cards carrying a full note and history.

**The delete is what makes a second writer impossible.** A repo throws on
deleting a key it does not hold, and `applyWrites` is one transaction, so a
second attempt at an already-drained part fails before any of its creates land.
Two tabs, two devices and a background worker can all race for the same part
and exactly one wins, with no lock and no bookkeeping.

**An import with no entries left is a receipt.** Emptiness is what says the
file was taken whole, so no field records completion and the last drain is what
marks it. The record keeps the file's name, the tool it came from, and a hash
of the cards it listed — quantities included, order not — so a second upload of
one export is recognized on a device that never saw the first.

Recognition is all it offers. A file imported twice and a second identical
precon plan identically, so the import states what it will do to the card count
and leaves the choice with the owner. A receipt covers no card added by hand,
which is the other reason it can never be what a collection is read from.

**The collection reads both shapes as one**, matching a part's entry to a
written record by the identity the merge rule already uses, so an entry needs
no address of its own. Editing a card that has not been written yet rewrites
its part: a delete then costs two points and the card is never created at all,
against three to create it and one to remove it afterwards.

**None of this makes an import faster.** The same cards cost the same points
and take the same hours. What it buys is an upload that cannot be half-consumed
and a collection that is complete from the moment the file is accepted.

**Only a person can say whether a second identical file is a mistake.** Two
scans of two identical precons export identical bytes, and merging them is
right for the second precon and wrong for the double-click. Re-importing sums
quantities silently, so the check is a question about the filename rather than
a refusal.

### Scanning

Scanning goes to a **staging list**, not straight to a destination. Scan
freely, then decide at commit: discard it (you were checking prices), or send
the batch to a container, deck or list. Provenance — new cards versus from
collection — is chosen per batch at that point. Fewer decisions than choosing a
mode upfront, and it makes price-checking first-class rather than an abuse of
the import flow.

Destinations: a container; a deck from collection (owned cards move into its
container); a deck as new (added to owned totals *and* placed); or a design
only, with no collection entry created.

**Source reconciliation.** Committing into a deck means saying where each card
came from. One row per card with a source selector, kept cheap:

- Prefill, don't interrogate. One plausible source fills silently; several fill
  the likeliest and allow a change. A hundred dropdowns demanding attention is
  worse than ManaBox today.
- Bulk actions primary, per-card the escape hatch. Batches are homogeneous.
- Sort by whether a row needs attention, so a hundred-card batch with three
  problems shows three things.
- The selector picks a **stack**, not a container — the same print in two
  conditions is two stacks, so options read "Binder A — NM, nonfoil".
- **Language is chosen with the printing, not beside it.** A print id pins it,
  so the printing picker is where it lives — defaulting to the card language
  setting, and read off the card itself when scanning.
- Scanning more copies than you own is normal with playsets. Scan four, own
  one, default to one-from-collection plus three-new and say so.

Because entries are stacks rather than individual cards, moving one copy is a
decrement on the source and an increment on the destination, not a pointer
update. Moving a whole deck is ~200 writes; batch through `applyWrites`.

## History, snapshots and forking

Three needs, three mechanisms. Conflating them is where this goes wrong.

### Undo — client only

Stack in IndexedDB, kept for a meaningful window. Never goes to the network:
cross-device undo isn't an interaction anyone wants.

**Undo applies the inverse to current state; it never writes an old state
back.** Deck holds A, B, C. Phone adds D, laptop (unsynced) adds E. Undo by
state-restoration writes {A,B,C} and destroys E. Undo by inverse computes
current-minus-D and E survives. Pair with `swapRecord` so a genuine race fails
loudly.

### Recent changes — bounded tail in the deck record

Not an undo buffer. Its job is looking back over the last handful of changes,
across devices, and *then* naming one as a snapshot. That works because the
diffs are invertible: current state plus N inverse diffs reconstructs any of
the last N states, so "that version was good" is reachable retrospectively.

- A diff is ~100-200 bytes. Ten is 1-2KB, fifty is 5-10KB, against a deck
  record of ~6-8KB for 100 cards.
- No hard wall, just write bandwidth: the whole record is rewritten per edit.
- **The bound is client policy, not schema.** Raising 10 to 50 needs no lexicon
  change, so starting conservative costs nothing.
- Bound by count, not time — nothing prunes a record until its next write, so a
  time limit leaves stale entries for months and buys nothing.

### Named snapshots

A "save version" button writing a separate record: named, unbounded, complete.
The only thing that delivers restore, since a bounded tail can't reach past its
window. A 100-card list is 5-10KB, so a dozen per deck is nothing.

**Restore auto-snapshots current state**, so restoring is itself undoable.

### History tab

One merged timeline: named snapshots and states reconstructed from the tail,
both restorable, visually distinguished. Tail entries age out as they fall off
the window — say so, since that's the prompt that gets someone to name one.

### Forking

A fork is a new deck copied from a source, either current state or a named
snapshot. Branch-versus-copy is **one optional field**, not a history copy:

- **Fork** records `forkedFrom` (at-uri + cid, plus snapshot name if any). The
  UI can show provenance, diff against the parent, list siblings.
- **Copy** records nothing. An independent deck starting from the same list.

Lineage is a pointer, not a duplicate, the way a git fork shares history rather
than copying it. A dangling pointer degrades to "forked from a deck that no
longer exists".

Forking someone else's published deck is the same mechanism with the at-uri
pointing at their record, so it wants designing alongside Explore.

### Activity feed

Derived from the firehose once Phase 3 exists, with no extra records and no
dependence on the in-record tail. Feeds are recent-biased, so losing old
activity to a rebuild is acceptable here in a way it wouldn't be for snapshots.

## Open questions

**Design-vs-built is an assignment problem.** Entries carry quantities, so
states are per copy rather than per entry, and an "any printing" entry competes
with a print-bound one for the same stack. Greedy matching gives different
answers by iteration order. Needs a defined resolution order: print-bound
first, then any-printing, extras as the complement.

**Set completion counts printings, and some collectors count treatments.**
A foil and a nonfoil of one printing share a Scryfall id, so counting ids
answers "which cards from this set do I have" and never "have I got both
finishes". The second is a larger denominator — printings times the finishes
each offers — and it is a preference rather than a correction, so it waits for
somewhere to keep preferences. Marked `todo(settings)` where it is displayed.
