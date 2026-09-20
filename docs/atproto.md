# atproto

Constraints the protocol puts on the design, and what it costs to work with.

NSIDs carry no game segment: `app.manaweb.card`, not `app.manaweb.mtg.card`.
Manaweb is an MTG app, and a segment added against a game that may never exist
would sit in every record forever. That reverses an earlier decision — the
original argument was firehose filtering and cheap optionality, but filtering
by NSID stays clean either way, and the optionality was speculation.

- **Records sit flat under `app.manaweb.*`**, with an area segment only
  where a genuine cluster earns one. Surveyed 2026-09-07: Leaflet, Streamplace,
  Frontpage and Standard all put their record types directly under the app
  authority and group only real clusters (Leaflet's 23 `blocks.*`). Bluesky's
  uniform four segments come from having 404 lexicons across 47 authorities,
  not from a rule. So `app.manaweb.game.*` later is fine — that is a
  cluster — but a `collection.` segment holding one record would not be.
- The owned-card record is `app.manaweb.card`, not
  `app.manaweb.collection`: each record is one card in however many copies,
  so "collection" would name the whole rather than the line. `card` matches
  how the domain talks — ManaBox exports one row per card with a quantity
  column. It does mean `manaweb_scryfall::Card` (a printing) and the record
  type want distinguishable Rust names.
- Adding a *new* lexicon collection later is cheap.
- Changing an *existing* NSID's required shape is not. Records written under it
  are permanent, since we don't control other people's repos. Additive optional
  fields are safe; don't remove fields or add required ones.
- Merging two collections later should be done by normalizing at the AppView
  ingest boundary — keep reading both NSIDs, map to one internal
  representation — rather than migrating PDS records, which needs a per-user
  opt-in flow. That's also the escape hatch if the NSID root ever has to move.

## Import speed is the Phase 0 constraint

Measured against the reference PDS, not assumed. `applyWrites` caps at **200
writes per call** with a 1MB body, and writes are rate-limited per account in
two windows: `repo-write-hour` 5,000 points and `repo-write-day` 35,000, where
a create costs 3 points. So **1,666 creates an hour, 11,666 a day**.

A 10,000-*stack* import is therefore about six hours and 86% of the day's
budget. A drain pays one point more than that: 199 creates and the delete that
retires the part come to 598, so eight parts fit in an hour and carry 1,592
stacks between them.

**Stacks are 70% of cards, measured.** An 11,839-card collection across two
ManaBox binders came to 8,321 stacks: five hours and 71% of a day. The earlier
guess that bulk commons would collapse heavily was wrong twice over — most of a
collector's cards are singletons, and where copies do repeat the exporting tool
has already summed them into a quantity column, so the client's own merge finds
almost nothing left to do. It earns its keep against formats that emit a row
per copy, and as the thing that stops a re-import duplicating what is there.

So coarser records are not forced, but import is a resumable background job
that has to be honest about taking hours.

**The upload is not paced at all.** 8,321 stacks pack into 42 parts, 1.89MB
and 126 points at three a create, which is three calls and a few seconds. What takes hours is turning
those parts into cards, and by then the collection is in the repo, replicated
and readable. The ceiling stopped being what a person waits for and became what
the app catches up on.

**A lost answer needs no investigation.** Draining a part is one transaction
that retires the part as it writes, and [`data-model.md`](data-model.md) covers
why a second attempt at one cannot land. So a resume asks the PDS nothing and
chooses no key in advance, and the lock it takes is a Web Lock between this
browser's own tabs rather than anything the PDS knows about — what the paced
writer it replaces had to do, it no longer does.

**Let the server pick record keys.** A TID is a millisecond clock plus five
random bits of clock id, kept monotonic only within the process that mints it,
and the reference implementation says of those bits that they are "not
guaranteed to be collision resistant". Two devices writing in the same
millisecond can therefore mint the same key, which fails one of their
transactions outright. `prepare.ts` already falls back to a server-side
`TID.next()` when a write carries no key, so omitting it puts one clock in
charge; `applyWrites` answers with a `results` array parallel to the writes,
carrying the uri and cid of each. Measured against the reference on 2026-09-15.

**A write already tells you the repo's revision.** `applyWrites` returns
`commit.rev` alongside those results, so a client knows the revision after its
own writes without asking. What it cannot cheaply learn is the revision after
someone else's: `com.atproto.sync.getLatestCommit` answers unauthenticated on
`pds.e0n.sh` and is gated behind auth on `bsky.social`.

**`listRecords` was never meant to answer "what changed".** Its parameters are
`repo`, `collection`, `limit`, `cursor` and `reverse` — no revision, no time,
and the `rkeyStart`/`rkeyEnd` of older versions are gone. The cursor is an rkey,
so `reverse` plus a cursor does return only records sorting after it, but that
is ordering rather than history: a collection keyed `literal:self` sorts
nothing, an account migrated in by `importRepo` carries keys minted on another
server's clock, and a process restarting with a backward clock can mint a key
below one it already wrote. Useful as an optimization, never as the argument.

The primitive with an actual argument behind it is
`com.atproto.sync.getRepo?since=<rev>`, which returns a diff of blocks from that
revision — what `rev` is for. It costs CAR and MST parsing in the browser, and
it is one of the endpoints `bsky.social` gates, so it waits for a reason to pay
that.

`com.atproto.repo.importRepo` is not an escape hatch: it needs `ACCESS_FULL`
with `repo:manage`, and a signed CAR file a browser client can't produce
because the PDS holds the signing key.

**Run against a limited PDS on 2026-09-16**, importing 4,336 ManaBox rows as
4,333 stacks into a fresh account. The upload was three `applyWrites` calls and
a few seconds; the drain then ran eight times back to back and stopped itself.
A drain charged 598 points — 199 creates and the part's delete — and the
remaining budget stepped down by that each time, 2674 to 2076 to 1478 to 880
to 282, so the arithmetic above is the server's arithmetic.

**The header names whichever bucket has least left, which hides the one you
care about.** The first calls reported `3000;w=300`, the per-IP bucket, falling
one per request; only once it dropped below the write budget did the header
switch to `5000;w=3600`. A client reading the figure without the policy would
have paced against the wrong window.

**Pacing off the header meant no refusal at all** until a reload threw the
deadline away. When one did arrive it carried `retry-after: 3363` and a
`ratelimit-reset` agreeing with it, and `ratelimit-remaining: 0` against 282
before the call — so a refused write is charged, not refunded. Reading
`retry-after` first is right, and the 429 is the fallback rather than the
mechanism.

**`listRecords` answers newest first.** Parts therefore drain in reverse of the
order they were written, which nothing depends on but every count does: the
short final part goes first, so a window's work is not always a round number of
records.

**A self-hoster cannot raise them, only switch them off.** The budgets and
windows are hardcoded; `PDS_RATE_LIMITS_ENABLED`, `PDS_RATE_LIMIT_BYPASS_KEY`
and `PDS_RATE_LIMIT_BYPASS_IPS` are the whole surface. The default is *off*,
which matters more than it sounds: a self-hosted PDS that never set the
variable enforces nothing, so an import against one runs flat out and proves
nothing about what a limited one does. Set it deliberately to test the pacing.

**Batching buys round-trips, not headroom.** `applyWrites` sums points over its
writes rather than charging per call, so 200 creates cost the same 600 points
either way. What the batch buys is one atomic commit and one round-trip, and
the body limit is 1,000,000 bytes — a stack carrying a full note, tags and
history runs past 12KB, so 200 of those would not fit and a batch has to be cut
by size as well as by count. Exceeding either limit is charged before it is
refused, with no refund.

**Pace from the answer, not from the table above.** Every response carries
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and
`RateLimit-Policy`, on success as much as on a 429, and all four are named in
`Access-Control-Expose-Headers` so a browser can actually read them — which is
a separate permission from sending them. The figure is whichever bucket has
least left, including a per-IP one, which is exactly the bucket that would
refuse the next call, so pacing off it needs no guess about which it is. A PDS
reporting nothing is enforcing nothing, and can be written to as fast as the
answers come back.

## Localhost OAuth works, but only by default

The spec makes the loopback allowance optional for authorization servers, and
the reference provider defaults it on (`atprotoLoopbackClientMetadata`), so it
works unless a PDS explicitly disables it.

`client_id` must be exactly `http://localhost` — no port, no path, and
`127.0.0.1` is rejected there. Its `scope` parameter has to name `atproto` or
the id itself is refused: `ATProto Loopback ClientID must include "atproto"
scope`. Redirect URIs go in query parameters on the
`client_id`, defaulting to `http://127.0.0.1/` and `http://[::1]/`, and ports
aren't matched, so a shifting dev-server port is fine.

**The dev server has to be reached at `http://127.0.0.1:<port>`, not
`http://localhost:<port>`.** The rule inverts between the two fields: the
client id must say `localhost`, and the redirect must not, because the provider
refuses `localhost` as a redirect host. `@atproto/oauth-client-browser` hides
this behind a hard redirect and then throws if the ports disagree.

Sessions have a ceiling. Any public client — `token_endpoint_auth_method:
none`, not first-party — gets access tokens of 60 minutes and a session and
refresh lifetime of **two weeks**, in production as much as in dev. A
resumable multi-hour import fits inside that; a job running unattended for
weeks does not.

## The client metadata document

`web/public/oauth/client-metadata.json`, committed and deployed with the app.
A public client: PKCE, DPoP-bound tokens, and no authentication at the token
endpoint, since a browser keeps no secret.

**It identifies the client, not the AppView.** Every field describes the
frontend, and our AppView isn't in the flow at all since the browser talks to
the PDS directly. A second frontend against the same AppView publishes its own
document at its own `client_id`, and users see it as a separate app to revoke
separately.

Nothing registers it anywhere: the authorization server fetches it from the
`client_id` URL when a user authorizes, so it has to be on the app's own
origin. `client_id` must equal that URL exactly, and the reference provider
also wants `client_uri` to be a parent path of it. The response has to be a
plain 200 with `application/json`, which a single-page fallback quietly
violates by answering 200 with HTML for a missing path. `just verify-oauth`
fetches a deployed copy, no local check being able to tell whether it arrived.

**Committed rather than generated.** The client imports the same bytes to
decide what to request, and a subset is all it may ask for. Generating per
environment would also invent the problem it appears to solve: `client_id` is
whatever string the bundle sends, so one production URL serves every
deployment and only a client deriving it from `window.location` breaks. Two
callbacks are declared, production and `dev` —
[`architecture.md`](architecture.md) covers why that's enough for previews.

Scopes are granular — `repo:app.manaweb.card` and one per other record type
we write, which is all a client that writes only its own records needs. Reads
need no scope, records being publicly fetchable.

**They are granted, not merely accepted.** Signing in against `pds.e0n.sh` on
2026-09-10 returned every one requested, and its consent screen itemizes them:
one row per collection, with create, update and delete marked separately. So
asking for the lot costs one legible screen rather than a vague one, which is the argument for asking once at sign-in instead of staging
the scopes behind the features that need them.

`transition:generic` is the fallback for a server that refuses the granular
form, and is not requested until one does. It grants app-password-level access
to the whole repo, which that screen renders as managing posts, likes and
follows and reading private preferences — everything, to write five
collections.

**`repo:` takes `*` or an exact NSID, and each one takes an action.**
`repo:app.manaweb.card?action=create` grants creates and nothing else; an
unqualified scope means all three, since `action` defaults to the whole set.
Two independent PDS implementations enforce it and the qualified form is live
in the wild, so the enumeration is not the finest grain available — it is the
coarsest of three.

Only the collections v0 writes are declared, and each unqualified rather than
narrowed to the actions used today: `app.manaweb.import` is created now and
updated and deleted by the drain, and a scope narrowed now is a second consent
prompt within the same feature. A scope for a record type nothing creates is authority held for
nothing, and the cost of adding one later is a consent prompt that says what it
is for — which is a better moment to ask
than a signup that quietly took it. Scopes are matched as exact strings, so a
qualified form has to be written the same way in both places;
`web/src/config.ts` and the document are held to each other by a test.

**An upload is a resource of its own.** A `repo:` scope authorizes the record
that points at a blob and not the blob, so storing a picture wants
`blob:image/*` beside `repo:app.manaweb.profile`. The permission takes MIME
globs, and the spec bars it from permission sets, so it is always asked for
directly. `pds.e0n.sh` took it at PAR on 2026-09-19 — which `scopes_supported`
could not have told us, listing neither it nor the `repo:` family.

Which to request is a design choice, not something to read off the server.
`scopes_supported` carries `atproto` and the transitional scopes and nothing
else, on both `pds.e0n.sh` and `bsky.social`, yet both accept the `repo:`
family neither of them enumerates.

A loopback client has no document to gate: the server builds one from the id,
which carries the redirect and the scope as query parameters. So the scope is
part of the client's identity in development, and editing it mid-flow answers
the exchange with `invalid_grant` — the code was issued to a client that no
longer exists.

**The client metadata document is the gate before consent.** A request for a
scope the document leaves out is refused at PAR: `Scope
"repo:app.manaweb.deck" is not declared in the client metadata`. Nothing else
is refused there, and `bogus:nonsense` and `repo:*` each come back with a
`request_uri`.

**The token response is the gate after consent, and the only one.** RFC 6749
lets a server drop part of a scope request, so consent succeeds, the session
looks whole, and the first write 403s. Gate writes on the `scope` that comes
back rather than on holding a session. Measured against both servers
2026-09-10.

## Which PDS to develop against

`pds.e0n.sh` on sautekh runs the reference implementation, so that is the
primary target: it is what almost every self-hoster has and what `bsky.social`
serves, and a client that works nowhere else still works for nearly everyone.

**A second implementation is still the cheap way to find a bug in our own
assumptions**, because servers differ where OAuth bites and the difference is
invisible until something 403s. Tranquil's per-permission consent screen was
wanted to force a partial grant; this one grants what it is asked for, so that
rig can wait until an implementation disagrees.

**`rsky` is worth reading whether or not it is worth running.** It is the Rust
one, so it is the implementation whose source we can work in, and its choices
— Postgres over SQLite, S3-compatible blobs over local disk — are the ones a
real deployment makes. It implements `com.atproto.repo.importRepo` in full,
streaming the car and verifying the diff, with its own size ceiling in
`IMPORT_REPO_LIMIT`, so reading how it bounds an import is more use to us than
anything we could contribute there.

Writing our own is a project, not an exercise, and it competes for the time
this one needs. Reading rsky buys the same understanding.

## The query API is XRPC, everything else is plain HTTP

XRPC is nothing like gRPC despite the name: plain HTTP and JSON at
`/xrpc/<nsid>`, GET for a lexicon `query` and POST for a `procedure`, flat URL
query parameters, errors shaped `{"error": "...", "message": "..."}`. Adopting
it is a path convention and a schema language over the HTTP we would write
anyway, not a transport.

- **The `rpc:` scope is defined in terms of XRPC methods**, so a call carrying
  the user's identity is expressible as a permission. A hand-rolled path isn't,
  and our client metadata already declares scopes.
- Any atproto client can call it without bespoke code.
- Methods are lexicon files, so `tools/lexicon-check` covers them alongside the
  record schemas.

The catalog, its manifest and the health check stay plain HTTP — static files
and operations, with nothing atproto about them. `/xrpc/` is a reserved
top-level prefix, so both live on one server the way every PDS does. **No
parallel REST mirror**: two surfaces for the same methods is two things to keep
in sync, and an XRPC query is already a REST call.

Errors are stringly-typed, query inputs are flat so nested input needs a
procedure with a body, and streaming is a separate `subscription` type over
websocket — which is how the firehose itself is defined.

## Domains: three, not one

Three concerns that don't need the same domain, and conflating them is what
makes migration look frightening:

- **NSID root** — `app.manaweb.*`, from `manaweb.app`. Reverse-DNS,
  permanent, embedded in every record ever written, and it needs DNS control
  rather than hosting. Registered, so this is settled: after the first record
  exists it can't change without a per-user migration.
- **App hosting** — `manaweb.app`, and the app is the only thing on it. The
  signed-out root is the front page rather than a separate marketing site,
  because moving the app to a subdomain would move the `client_id` with it.
  Changeable, unlike the NSID root that shares its name, but not free.
- **PDS** — a separate domain, deliberately, and `mnwb.me` is it. atproto's
  production guide wants the PDS and the app on different registrable domains,
  since blobs served from the PDS would otherwise share an origin with the
  app's OAuth and session pages. Moving a PDS hostname later costs one PLC
  operation per account, which is an afternoon at our scale and a project at
  someone else's, so it scales with how long it is left.

OAuth `client_id` follows app hosting, so moving domains costs users one
re-authorization. Unrelated to NSIDs.

## What a PDS actually commits us to

Less than it looks, and not where it looks. The DID is permanent; the endpoint
and signing key it points at are one PLC operation from changing, so an
implementation swap is a migration — the repo travels as a car file, and the
retired signing key stays in the audit log keeping old commits verifiable.
Neither server's choice of database enters it.

**Swapping the software behind a settled name is an announcement, not an
outage.** A sequence number is only a consumer's replay position, and
correctness is answered per account: a break in a repository's commits marks
that repository desynchronized and the consumer refetches its car, while a
`#sync` event lets the new server assert each head rather than wait to be
caught out. So the hostname can be permanent, which is what we want of it,
since it is the `did:web`, the OAuth issuer and the name on every consent
screen.

**The lock-in is the rotation key.** Only a rotation key can sign a PLC
operation, and a PDS holds one of its own that is the sole entry on every
account it creates. Lose that key and the DIDs anchored to it are not hard to
move, they are unmovable — nothing can ever update the document again. So it
belongs in a password manager the moment a PDS is worth keeping accounts on,
and an account worth keeping should carry a personal rotation key too, which
PLC honors ahead of the server's.

**A crawled PDS is public, and an uncrawled one is only quieter.** Dropping the
crawler list keeps a host off relays, so nothing it holds reaches the firehose,
but each account still registers in the public directory, whose log is
append-only — a deleted one leaves a permanent record that it existed and
where it lived. A directory of our own would erase even that, at
the price of DIDs nothing else resolves — the browser client takes a
`plcDirectoryUrl`, so such a rig is buildable and can only ever be a rig. An
uncrawled host on the public directory keeps the sign-in ordinary, which is
worth more.

**So one host, not three.** `pds.e0n.sh` is crawled, and holds both the cast
in `fixtures/README.md`, wiped whenever it suits, and the long-lived accounts
that prove federation works. A third for staging would be crawled to be worth having, and a crawled
host is indistinguishable from production to the network — it would spend the
same public directory and the same firehose, protecting only our own disk,
which separate accounts already do.

## Sharing

Decks, lists and collections should be shareable — to Bluesky as a post, or as
a link to show a friend what you own.

Smaller than it sounds, because **atproto records are already publicly
readable**. Sharing needs no permission system and no copy of the data, just a
route taking a handle or DID plus an rkey and rendering what it fetches
straight from that user's PDS. Posting to Bluesky is an ordinary
`app.bsky.feed.post` through the same OAuth session.

The one genuinely server-side piece is OpenGraph meta tags, since link previews
need markup at fetch time rather than after hydration. One of the few things
v0's otherwise-static server has to do.

**A collection is not a decklist.** Every entry is world-readable by anyone who
knows the DID, which makes a collection an itemized, valued inventory of
physical goods tied to a real identity. Different in kind from a public post,
and most people importing ten thousand cards won't have thought it through.

Defaults, which govern *our surfacing* rather than access: lists and decks
shareable, collections not. Trade lists must be public to function at all,
wishlists are usually fine, collections are the sensitive one.

**Don't build invite-only yet.** There's no access control on atproto records
today, so any gate we render is decoration that anyone bypasses by reading the
PDS. For a decklist that's embarrassing; for an inventory of valuables it's a
real harm. Better to say "this is public" than imply a control that doesn't
exist.

**The honest alternative local-first already gives us** is that publishing to
the PDS is a separable step, since the client keeps its own view regardless. So
"keep my collection on this device only" costs almost nothing to offer. It
loses multi-device sync and dies with the browser profile, so it needs an
export nag, but it's a real choice made knowingly rather than a fake toggle.

Say all of this in the import flow, before ten thousand cards land.

### What Spaces changes

[Spaces](https://atproto.com/blog/atproto-spaces-alpha) is atproto's answer and
the mechanism collections eventually want: a space authority (a DID) gates
which other DIDs can access the data. Invite-only, properly.

Not yet. Alpha since August 2026 — no security review, backups not running,
migrations possibly destructive, hosted PDS deleted afterwards, protocol design
not final. It also needs a *spaces-capable* PDS, so adoption is gated on the
ecosystem rather than on us.

It's also **access control, not confidentiality**: data in a space is
unencrypted and readable by every authorized member and the host. Spaces gets
you "my friends can see this, strangers can't", never "nobody can". Probably
the right level for a collection, but say it accurately.

Designing toward it costs nothing now, since our server never reads a user's
collection in v0. Just don't build anything that *depends* on collection
records being publicly readable.

## Open questions

**Backfill has an upstream answer.** Handled for a user's own data by reading
their own PDS, and a real problem only at Phase 3, where the index needs
records predating our subscription. Tangled's Bobbin doesn't build it: Hydrant
tails the firehose, pulls every repo's CAR and replays it from cursor 0 over a
websocket, while Slingshot caches single record and identity lookups to cover
the warm-up. That rebuilds their entire dataset in 30 seconds to 20 minutes
with no disk at all. Neither has a public instance, so what's worth copying is
the pattern rather than a service to consume.

## References

- [atproto Spaces alpha](https://atproto.com/blog/atproto-spaces-alpha) —
  access control, not confidentiality; alpha as of Aug 2026
- [atproto going to production](https://atproto.com/guides/going-to-production)
  — PDS and app want separate domains
- [atproto OAuth spec](https://atproto.com/specs/oauth) — loopback client
  rules; the allowance is optional for the authorization server
- [atproto permissions spec](https://atproto.com/specs/permission) — `repo:`
  scope syntax, and the transitional scopes it replaces
- [Introducing Bobbin](https://blog.tangled.org/bobbin/) — a diskless AppView,
  and the Hydrant/Slingshot pair that makes backfill someone else's problem
- [XRPC spec](https://atproto.com/specs/xrpc) — `/xrpc/<nsid>`, query versus
  procedure, and the error body
- PDS write limits are in the reference implementation rather than the specs:
  `packages/pds/src/rate-limits.ts` for the point budgets and
  `packages/pds/src/api/com/atproto/repo/applyWrites.ts` for the 200-write cap
  and per-operation costs, in `bluesky-social/atproto`
