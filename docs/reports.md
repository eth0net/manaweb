# Reported scans

A plan, not a built thing. Written 3 Oct 2026, after two failures showed up
in production that nothing in the repo can reproduce. Four of its decisions
were overturned on 4 Oct and are marked where they were made.

## What this is for

Two scanner faults, both measurement-blocked, and the measurement wants
frames nobody has:

- **A card found where there is none**, against a busy background. The flood
  share guard takes this from 74% of such pictures to a tenth, and a tenth is
  what is being seen. Tightening that number is ruled out in
  `scanner.md` — it costs real cards far faster than it buys refusals.
- **The wrong card, at a thin margin, in low light.** `STEP` is an absolute
  level difference, so in a frame occupying a narrow band it is a far larger
  share of the contrast than it is at noon. Every step between 6 and 12 scores
  alike on the 92 well-lit photographs, which is to say the constant has never
  been asked the question that matters.

Neither can be worked on from the repo's corpora, which hold cards, on tables,
in good light. What is missing is the frames that go wrong, and the only place
those happen is on somebody's phone.

**A reported frame has to be the bytes the engine read.** Not a thumbnail and
not a re-encode: the whole point is re-running detection over the same input
and getting the same verdict. Anything that resamples on the way out makes a
report unscoreable.

## Shape

Four pieces, in the order they earn their place.

### 1. Frames kept on the device

`web/src/scan/frames.ts` already holds frames in IndexedDB behind a cap and a
time limit, with the whole path inside `import.meta.env.DEV` and
`web/vite/sealed.ts` failing a build that carries it. Keeping them in a
production build, still local, costs almost nothing and is what a report has
to have to carry.

**There is no local export, and that was a decision.** An earlier draft of
this gave the device a way to write frames out, on the reasoning that one
person scanning their own collection could then move them by hand. Nobody is
going to. A fault found mid-scan is reported in the three seconds it takes to
press a button or it is not reported at all, and a leg that asks for a cable
and an evening is a leg that turns every report into a chore nobody does.

It also settles the privacy shape before any of it leaves a device: frames
are kept because a scan might be worth reporting, and reporting is a press.

### 2. A procedure to send one

XRPC, because `atproto.md` already says the query API is XRPC and nothing
else is, and a second convention would be a second thing to remember.
`app.manaweb.reportScan` takes the frame as a blob and the read beside it —
the `Read`, `Said` and `Told` shapes in `frames.ts` are what the dev route
already carries and are worth keeping rather than inventing again.

It also carries the catalog version and the engine fingerprint. A report that
cannot say which index it was read against cannot be scored against that
index later, and `fingerprint` exists for exactly this kind of stamping.

### 3. Who may send

**Anyone signed in, which is not the same as anyone.** The AppView verifies
an inter-service token the client asks its own PDS for
(`com.atproto.server.getServiceAuth`, audience our own DID), which is the
atproto way to prove who is asking without the server holding anything of
theirs. A DID that reached that point is an account on a PDS somewhere, which
is a cost to forge a hundred of.

An earlier draft said a named list of DIDs and nobody else. That is the wrong
shape for what this is for: the people whose scans go wrong are the people
not building this, and an allowlist means every one of them has to ask to be
added before they can tell us anything. The corpus this exists to grow comes
from exactly the users an allowlist excludes.

**It earns its place with one reporter and gets better with five.** The
faults happen on a phone and the frames are on the phone, so a press that
puts them where the scoring tools can reach them is the difference between a
corpus that grows and one that does not.

### 4. A way to fetch them, which is not a view

Reading a report is something that happens where the scanner is being worked
on, so the read side is a command that writes a directory and nothing else.
`photos` and `refusals` already score a directory, so that is the shape the
corpora want anyway — frames holding no card, and cards in poor light.

A developer session has the bucket's credentials already, the way
`manaweb-upload` does, so this needs no endpoint, no signing and no view. The
server's whole part is the write side: check who is asking, choose the key,
hand back the one grant.

**The fetch takes them away as it goes**, so the bucket is a queue rather
than a store and ten gigabytes is never the thing that runs out. Copy, check
the bytes arrived whole, then delete — in that order and never on a partial
run, because the frame exists in one place by then. Which also says where the
archive is: the directory on the machine doing the work, backed up or lost
like anything else there. Two people pulling would split a corpus between
them, which is a reason to be the only one or to say who.

**So there is no admin UI in this**, and the thing it would have been for —
noticing a report arrived — is a line in the log the server writes anyway and
a count the fetch prints. A page to triage reports earns its place when
somebody is triaging rather than reading all of them, which is a different
number of users than five.

## What it costs, and what it breaks

**`AGENTS.md` says the server has no write handlers.** That rule is about
user data: collections and decks belong in a person's own repo and the server
never stands between. A reported frame is not that — it is telemetry about
whether this software works — but the rule as written admits no exceptions,
so it wants amending in the same change rather than quietly bending.

**Accepting images is a different posture.** Everything the server takes
today it fetched itself from Scryfall. The first thing it accepts from a
browser needs a size bound, a type check that does not trust the extension,
and a quota, before it needs anything else.

**The quota has to live in the process, and that is why.** The obvious place
to count is the bucket, which already holds one object per report. It cannot
work: a client asks for a grant and uploads afterwards, so fifty URLs can be
signed before the first object exists, and a counter reading the bucket would
authorize all fifty. What is being limited is the signing, so the count has
to sit where the signing happens. In memory is the right kind of state —
a restart resetting a rate limit costs nothing, and it keeps the promise that
this feature adds no table.

**Caps here are blast radius, not budget.** Five people at ten reports a week
is about two gigabyte-months a year against ten free, and some hundreds of
writes a month against a million — three orders of magnitude inside the free
tier, in both dimensions. So nothing sized against cost would ever bind. What
the numbers are actually for is a retry loop that signs in a tight circle, or
somebody who found the endpoint: size them so that a fortnight of either is
still inside the allowance, not so that ordinary use approaches them. A
starting pair worth arguing with rather than adopting: twenty grants per DID
per day, two hundred across everyone, and a lifecycle expiry behind both.

**A record in the reporter's own repo would need no write handler**, and is
the wrong answer anyway: a repo is world-readable, as `defs.json` says of
visibility, so filing a photograph of somebody's room there publishes it. The
server holding them is what keeps them unpublished, which is the opposite of
how the rest of this works and is why it is written down.

**A frame is a photograph of somebody's table.** Reporting is a press and
never automatic, the panel says what is about to be sent, a report can be
taken back, and frames are dropped on a schedule rather than kept. None of
that is negotiable and all of it is cheaper to build now than to retrofit.

## Open questions

- Whether the second bucket wants its own credentials in the environment or
  can share the token the catalog uses, which depends on how narrowly that
  one is scoped. Two tokens is the safer default: the catalog's is scoped to
  one bucket today and widening it would put the frames behind the same key
  that publishes the catalog.
- What the three numbers should be. The ceiling above is reasoned from the
  free tier and from nothing else: nobody has reported a frame yet, so there
  is no rate to size against, and the first week of real use is the
  measurement.
- What a frame costs to store once there are thousands.
- Whether a report from a DID nobody recognizes is worth keeping by default
  or worth holding until somebody looks. Open because it only matters once
  somebody who is not a friend finds the endpoint, and the answer then
  depends on what they send.

## Where the frames live

**A second bucket, not a prefix beside the catalog.** An R2 custom domain
publishes the whole bucket rather than a path within it, so a report filed
next to the catalog is a photograph anyone can fetch who guesses its name. A
write-only token does not help either: what exposes an object there is the
domain in front of it, not the credential that put it there.

**The token stays on the server and the bytes do not go through it.** The
AppView is asked for somewhere to put a frame, checks the DID, picks the key
itself and hands back a presigned `PUT` good for a minute or two; the browser
uploads straight to R2. No credential reaches a browser and no frame crosses
the Vultr box, which is the whole reason for signing rather than proxying.
`object_store` already signs: the `Signer` trait is in the version
`manaweb-objects` depends on, so this is a method call rather than a
dependency.

Nothing reads back out through the server, so the bucket wants no public name
and no route in front of it.

**The server picking the key is what bounds it.** A presigned URL authorizes
one method on one key until it expires, so a client that cannot choose the
key cannot overwrite anything, and one that cannot extend the expiry cannot
keep the grant. The size bound rides along as a signed header. What it cannot
do is prove the bytes are an image, which is a thing to check on the way back
out rather than on the way in.

**An upload nobody confirmed is rubbish, and expiry collects it.** The report
record is written after the frame lands, naming the key, so an object with no
record is an upload that failed or was abandoned. The lifecycle rule that
bounds storage takes those away without anything else having to notice.

**Browsers need the bucket to say so.** A presigned URL authorizes the
request; CORS is what lets a page make it, so the bucket wants the app's
origin and `PUT` named. R2 omits CORS headers from an expired URL's refusal,
which means a browser cannot read why it failed — so a URL is refreshed
before it lapses rather than retried after.

**A second bucket costs nothing by itself.** R2 bills storage and operations
across the account, not per bucket, against ten gigabyte-months and a million
writes a month free. At a couple of megabytes a frame that is thousands of
reports before anything is owed, and the catalog settles around 27MB of the
same allowance.

**There is no cap to set on a bucket.** Storage and object count per bucket
are both unlimited, so nothing at that layer will stop reports arriving. What
bounds them is a lifecycle rule expiring objects after so many days — which
is the mechanism to use, and which also means a corpus has to be pulled down
and kept before it ages out — plus the list of who may send, a size bound per
frame, and a count the server keeps.

## Keeping the corpus worth having

Not for the first version, but the shape is worth writing down before there
are thousands of frames and no plan.

A corpus grows redundant fast: the same table, the same light, the same
failure caught forty times. What it wants is coverage rather than volume, and
the measure of two frames being the same picture is already here — the
perceptual hash the scanner computes, over the whole frame rather than the
art box so that a frame holding no card can still be compared. One kept per
cluster inside so many bits is the obvious prune and needs nothing new.

**What to drop is the part that is not obvious.** Dropping frames the
detector now gets right keeps the set adversarial and makes every run
informative; keeping them is what catches the fix that breaks something that
used to work. Those pull opposite ways and the answer is probably both sets
kept apart, which is a decision to make with real frames rather than now.

## The fixes this unblocks

Named here so the corpora are collected with them in mind, not because either
is settled.

- **Texture outside the quad**, for the card found in clutter. `scanner.md`
  names the discriminator already, under the flood share guard. Nothing
  measures it today.
- **A flood step scaled to the frame's own range**, for low light. The
  present one is ten levels whatever the picture, which is a different
  proportion of a bright frame and a dim one.
