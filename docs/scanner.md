# The scanner

A photograph in, a printing out, entirely in the browser. What it does,
what each part of it was measured at, and what the parts nobody has built
would cost. Where it sits in the plan is [`roadmap.md`](roadmap.md).

**Client-side inference.** Recognition runs in the browser (WASM) against a
precomputed index shipped with the catalog. No server in the per-scan path,
works offline, nothing leaves the device.

**Beat ManaBox on printing identification.** ManaBox matches art only, so the
user picks set and finish by hand every time. Exact printing ID is the feature
worth switching for.

- Constrain, don't classify. Art match narrows to the printings sharing that
  art; set symbol and collector number pick among those, which is a handful-way
  decision rather than a thousand-way classification.
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
  Scryfall's `lang`. Cards before the 2015 frame carry no code, leaving the
  printed name's own script as the signal.
- Foil is glyph classification, not computer vision. The premium indicator sits
  between set code and language on that same line: `BLB • EN` nonfoil,
  `BLB ★ EN` foil. Traditional foils share collector numbers with nonfoils, so
  this marker is the only differentiator.
- Era caveats: the 2015 frame puts it there; the frames before it put a star
  next to the collector number. Older cards have no collector line, but foils
  didn't exist before Urza's Legacy (1999), so absence is itself a reliable
  nonfoil signal.
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

Asking all four framings against every one of the index's 54,584 entries is
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
turn, down to half of it. Either way the artwork is cut out of it at each of
the boxes below, and the nearest entry the index holds to any of those crops
is the answer.

**The art box is not one rectangle, and the shape of a card does not say
which.** Scryfall cut their crops to the artwork rather than to the frame, so
what settles it is the crop's own proportions. Across all 54,584 of them:

| crop | of the index | which box |
|---|---|---|
| 626x457 and 616x452 | 76.4% | modern |
| 571x460 and 582x467 | 13.3% | the 1993 and 1997 frames |
| everything else | 10.3% | 74 sizes, none above 1.2% |

Two clusters are nine tenths of it. `just artbox` measures where each sits by
finding the crop inside Scryfall's own picture of the whole card, and four
boxes cover 92% of the index: the two above, plus full-art and one token
shape. More would be chasing fractions of a percent, and each one costs
something — every crop is another artwork the right answer has to beat.

**A median over a shape is a box no card has.** The first measurement cut by
card shape alone and reported one figure for `older`, which is three frame
eras: 2003 is the modern box to three thousandths, while 1993 and 1997 sit
4% of the card's width further in and 1.5% of its height higher. Their
median scores 90.0% where either real box scores 98.3%. So `artbox` reports
a spread beside each edge and cuts by frame as well as shape; the same
reading says full-art and tokens are each several boxes, which is why they
are the shapes still owed something. A `full_art` flag misleads in its own
way — 1,174 full-art printings, behind 1,050 artworks, carry the plain
modern crop, because the flag describes the printing and not the cut.

Scored against 420 of Scryfall's card images, sixty of each shape, which is
the capture nothing is wrong with:

| shape | printing@1 | share of printings |
|---|---|---|
| older | 98.3% | 30.7% |
| modern | 96.7% | 55.3% |
| borderless | 90.0% | 4.8% |
| full-art | 83.3% | 1.8% |
| walker | 65.0% | 1.3% |
| token | 56.7% | 5.3% |
| sideways | 5.0% | 0.7% |

**93.5% weighted by how often each shape is printed.** Tokens are the shape
left: their crops are the most scattered of any, so one token box reaches
part of them. Sideways cards are printed rotated, and the three of sixty
that come back do so through the framings rather than through anything
aimed at them.

**92 photographs of real cards** say what that set cannot. Phone camera, a
pale surface, even light, mostly upright at about three fifths of the frame,
and 85.9% of them name their own printing:

| shape | shots | printing@1 |
|---|---|---|
| token | 12 | 100.0% |
| modern | 33 | 87.9% |
| older | 13 | 84.6% |
| full-art | 12 | 83.3% |
| borderless | 22 | 77.3% |

**The condition is read one piece at a time**, so a shot of a sleeved foil
counts for both; fifty conditions named one to a shot answer nothing. Held
to the shapes that have an art box and to cards out of their sleeves, a foil
is the one treatment costing anything:

| | shots | printing@1 |
|---|---|---|
| bare nonfoil | 32 | 93.8% |
| bare foil | 26 | 76.9% |

Twenty-six shots against thirty-two, so it is a gap to shoot more at rather
than a figure to build on — it has already read as nothing over a smaller
set of the same cards, and a sleeve is on ten shots and cannot be told from
it yet.

**The margin says when to believe it.** Over those 92, every wrong answer
came back within two bits of its runner-up, and no right one was beaten:

| | shots | printing@1 |
|---|---|---|
| margin 4 or more | 65 | 100.0% |
| margin 2 or less | 27 | 51.9% |

So a scan can be accepted without asking about seven times in ten, and the
rest is a question worth putting to whoever is holding the camera rather
than a failure. **54% of the answers that were right still carry more than
one printing** — a median of two, out to fourteen — because an artwork is
reprinted. No hash settles that, and it is why a scanner asks at all.

**A scan lands in a scratch list, and the collection is what someone agreed
to.** Wrong is then cheap and interrupting is expensive, which is the whole
of how the two figures above are spent: accept the confident half without
saying anything, ask about the rest, and let the review catch what neither
caught. A summary of the last card sits beside the scanner rather than over
it, so a run of scanning is not a run of dialogs.

ManaBox puts the same panel in the way of every scan because theirs is where
a printing and a finish get chosen; here the scan already proposes both, so
the panel is somewhere to look rather than somewhere to answer. A scratch
entry therefore has to carry the printings its artwork matched, or a review
that changes one is a rescan.

**The list is the browser's own until someone commits it**, and committing
is the import path: planned against what is held, landed as
`app.manaweb.import` parts and drained into cards, optionally all into one
container. A scanning session is one device, so nothing is owed to a PDS
until there is something to keep, and the path that drains a CSV at whatever
the PDS will take already exists — see [`data-model.md`](data-model.md).

It asks nothing of the lexicons: `container` is already a field a card may
carry, `source` already says what the cards were read out of, and the file a
CSV names is already optional. What it does ask is that the review settle a
**finish**, which a card record requires and no hash of an artwork can see.

**Half of that question is already answered.** 52.4% of paper printings were
made in one finish only — 40.3% nonfoil, 11.3% foil, 0.8% etched — and the
catalog carries `finishes` per printing, so for those there is nothing to
ask and nothing to get wrong. The rest default to nonfoil with a toggle.

**Two priors are worth having, and both are priors rather than answers.**
Someone working through a foil binder says so once; someone opening packs of
one set says so once. What each buys:

| told | what it settles |
|---|---|
| this is a foil | the finish, where the printing was made in both |
| these are from this set | the printing, 86.9% of the time |

That second figure is the one to notice. An artwork is reprinted, which is
why 54% of right answers still carry more than one printing — but within a
single set an artwork is one printing in 58.2% of cases and already unique
in a further 28.7%, leaving an eighth where two treatments of the same art sit
in the same set and a person has to look at them.

**How close a match it was is a real thing to show, and only about
artworks.** Two printings of one artwork are the same picture, so the index
holds one entry for both and the distance to each is the same number. A
chooser between printings that showed a score would be inventing one: what
tells those apart is a set, a collector number and a finish, which is what
to put in front of someone. A chooser between *artworks* is the other case,
and there the distance means something. Measured over the 92:

| how far the next artwork was | shots | named its own printing |
|---|---|---|
| 6 bits or more | 45 | 100% |
| 4 | 20 | 100% |
| 2 | 15 | 73% |
| 0 | 12 | 25% |

Bands rather than a percentage, because 92 photographs put a dozen or two in
each row and a decimal read off that would be a fiction. The table is what
calibrates them, so it is worth keeping as the set grows; a number nothing
measured should not be shown at all.

**What was discarded is worth keeping too.** The index reader returns only
the nearest entry today, which is also why no margin reaches the client —
one change gives both, and a few more rows are what lets someone see what
came second and say it was that one. Behind a setting, since most
people are being asked to recognize their own card rather than to read a
Hamming distance.

Preferences have had nowhere to live (`todo(settings)`), and the scanner is
the first thing to need them locally rather than on a PDS: a scratch list, a
foil or set prior held for a session, and a switch for showing the numbers
are all the same one store in the browser, none of it worth a record.

**A prior never overrides what was read.** A finish the catalog rules out is
not offered whatever the session says; a card found to be from another set
is taken at its word and marked, because scanning the wrong pile is a thing
that happens. Where a reading and a prior disagree the reading wins and the
entry carries the disagreement, so review is somewhere to look first rather
than a list to go through. The same holds when a premium stamp is read off
the card: it is evidence, and the session setting is what it is weighed
against.

## What else a scanner could be made of

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
free filter — not mostly made of those four corners, or found in a frame
where under a quarter was ever flooded.

**A step and not a level**, because a level cannot tell a dark card from the
shadow lying beside it and joins the two into one run reaching the edge of
the picture: that was 25 of the first 49 photographs, each coming back with
its lower corners pinned to the corners of the frame. A card's border is a
step and shading is not. Ten levels is the middle of a plateau — six to
twelve score alike and fourteen begins losing cards — rather than a figure
anything derives. What it still cannot do is a black border on a dark table,
where there is no step to stop at.

**A quarter of the frame has to have been flooded** before what is left
over can be the card, an ordinary card's art box being a card's own
proportions to within a hundredth and passing every other check here. That
takes a card reported in 74% of pictures that hold none down to a tenth.
Tightening it further is the thing not to do: flood share is at once "is
this a photograph" and "how tight is the framing", so a guard that refuses a
picture of a card refuses a photograph filling most of the frame with it —
at 0.45 these same 92, center-cropped to four fifths, fall from 82.6% to
60.9%. Telling those apart wants something that is not framing-tightness, a
photograph having a surface with texture outside the card where a picture of
one has only more card.

**The shape filter's upper bound does nothing, and should.** The ratio is
the shorter side over the longer so it can never exceed one, and a card
tilted 44 degrees projects to a square; only the lower bound rejects
anything, a wall or a table edge. At 0.35 of slack it admits tilt up to that
44 degrees, and tightening to 0.10 would cap it at 29 — two of the
photographs are at 38.

**Rectifying to a canonical rectangle is what makes it worth the work**,
rather than the art box, which already answers for ordinary cards — nothing
below can begin without a known position on a known shape. Built with it: a
card is read back through the projection its four corners came from, at its
own 63 by 88, which settles framing and perspective together and stands one
lying on its side back up. Which end of it is the card's top is the one
thing left over, and nothing answers that yet.

**Matching the artwork wants leaving alone.** The alternatives are real and
each trades away something this design is built on:

**What the build keeps and what a browser fetches are not the same size.**
The store is 48 bytes an artwork, a 16-byte key and four hashes, which is
2.62MB; the published part drops the key, rows being positional, so it is
1.78MB at 33 bytes an artwork. Either way it barely compresses, hashes being
nearly random bits, so what is added to a row is added to the download.
Against that 1.78MB:

| how | bytes an artwork | the download becomes | why not now |
|---|---|---|---|
| a perceptual hash, as built | 33 | 1.78MB | — |
| which boxes its crop can be | +1 | 1.84MB | taken: two bits, and the builder already has the picture open |
| a 2x2 grid of mean color | +12 | 2.44MB | the tie-breaker, once a tie is what is losing |
| a gradient hash beside it | +32 | 3.53MB | doubles a key nothing has shown short |
| a 4x4 grid of mean color | +48 | 4.40MB | a finer grid than a tie needs |
| local features and a geometric check | thousands | gigabytes | robust to occlusion and perspective, and it ends shipping the index to a browser |
| a learned embedding | 128–512 | 9–30MB and weights | the answer if the hash proves insufficient, which nothing has shown |

Reading the card rather than the artwork is the other axis, and it settles
what no artwork can: which printing, and which finish. Full text recognition
wants a model of 2–10MB and 50–200ms a scan, so the cheaper form is to look
for the few marks whose place on the card is known — the premium stamp that
says a foil, and the two-letter language code — rather than to read the line
they sit in.

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

**The engine is reached over a C ABI, not a bindings generator.** The whole
surface is a luma plane in and four words out, so a pointer and a length say
it, and the same signatures serve a browser's `WebAssembly.Instance` and
later Swift and Kotlin. It builds with `cargo rustc --crate-type cdylib`
rather than a second crate, which keeps every native build free of exported
symbols. `tools/scanner-check` compiles it and holds it to what the native
build answers over the same probe — the hashes and the fingerprint, with and
without `+simd128`, which changes nothing: the vector extension gives the
compiler no license to reassociate a float. 45KB unoptimized.

**The index is a build-time artifact, not a runtime service.** Building it
means pulling ~100k images (~10GB) and hashing them, which is hours on 1 vCPU.
Build locally, publish the artifact, serve it statically, same as `web/dist`.
Incremental per-set rebuilds (~300 cards) are fine on the box. Throttle the
initial pull: hammering Scryfall's CDN is the "repeated mishandling" that gets
API access restricted.

**None of this is reachable from a browser yet.** The engine exports color
conversion and hashing over its C ABI and nothing else, so detection and
rectification — the whole of what the measurements above are about — stop at
the Rust boundary. The art boxes live in the builder rather than the engine,
the index reader keeps only the nearest entry and so cannot report a margin,
and nothing captures a frame from a camera. The retrieval is good enough to
build against; the way in is not built.

The order, then: the engine's own boundary, a confidence floor read off the
margin, and a scan landing somewhere it can be reviewed rather than in a
collection. Color, a second hash, or anything read off the card itself, only
where a measurement asks for it.
