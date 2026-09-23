# Architecture

What runs where, and why the AppView owns so little.

**The browser writes directly to the user's PDS** with its own OAuth session —
a public client using PKCE and DPoP, `client_id` being the URL of a static
client metadata document we serve. Our server never proxies a write.

- **No token state on the server.** Access, refresh and DPoP keys live in the
  browser, so they're not ours to lose. Store the DPoP key as a non-extractable
  `CryptoKey` and mean the CSP, because XSS becomes token compromise. Two
  Scryfall hosts have to be in `img-src`: `cards.scryfall.io` for card images
  and `svgs.scryfall.io` for mana symbols. `connect-src` cannot be narrowed
  past `https:` — the host a session talks to is whichever PDS the user is on.
- **rkeys are ordinary TIDs.** Deterministic rkeys only helped a stateless
  server that had to find a record without a lookup; a local-first client holds
  its own stack-key → rkey index. It also dodges an ugly choice: a
  deterministic key including the container makes moving a card a
  delete-plus-create, and excluding it stops a stack existing in two
  containers.
- **Read-your-own-writes falls out.** A write would otherwise travel browser →
  PDS → firehose → index before any server-backed view saw it. The client holds
  the records it read from its own PDS and applies its own writes on top,
  whether they came from an edit or from an import landing a batch.
- **That view paints from a cache, but still costs what it always did.**
  `listRecords` pages at 100 and has no `since`, so reading an 8,321-stack
  collection is 84 sequential round trips and 1.9MB — on every device, every
  load. What IndexedDB buys is that none of it is on the way to a first paint:
  the last read shows immediately and the repo's answer replaces it. Writes go
  in too, a second after they settle, so a visit paints what this browser did
  and not the read it replaced.
- **The cache is never what the import reads.** It decides whether a card joins
  a stack or starts one, and a record the cache has not heard of would become a
  second stack, so that path waits for the repo's own answer.
- **Making the read itself cheap needs something we do not have.** A revision to
  compare against would turn 84 requests into one, and no way of asking for one
  is portable — [`atproto.md`](atproto.md) has what each server answers. Until
  that is settled the real fix is the one the firehose section defers to Phase 3:
  a read endpoint returning a user's own records in one response.
- **The PDS is the device-sync mechanism.** Device B reads what device A wrote,
  with nothing of ours in between.
- Offline writes need a queue. `client_id` is tied to the deployment domain, so
  dev and prod need different ones; there's a localhost allowance worth
  checking before relying on it.

**So v0 needs no firehose consumer and no query API.** The AppView serves the
catalog, the app and the client metadata document, and runs the weekly
Scryfall sync. Indexing earns its place at Phase 3.

## Two origins, because there are two cadences

**Everything a browser fetches is static, and none of it comes from the
binary.** It doesn't all come from one place either, because the app and the
catalog change for different reasons:

| | origin | built from | changes on |
|---|---|---|---|
| app, client metadata | `manaweb.app`, Pages | the repo | a commit |
| catalog, manifest | `static.manaweb.app`, R2 | the cache | a set |

`static` rather than `catalog` because more artifacts of that shape are coming
— a scanner index, precomputed recommendations — and the Phase 3 query API
wants `api` alongside. Each is a set of content-addressed files and a
`manifest.json` naming them, so each gets a prefix of its own: the catalog is
`static.manaweb.app/catalog/`. Two sets at the root would both want to call
that file `manifest.json`, and the prefix is also what a prune can be scoped
to once one exists.

Changing what a set holds is three steps and the order is the whole of it:
upload the new files, deploy the client that reads them, then delete what the
old ones held. A client already loaded fetches on its own schedule rather than
on a deploy's, so anything else takes the files out from under it.

That order binds a format change as much as a move, and a push deploys the
client on its own. When colors became a bitmask the client went out first,
read the bucket's older file and showed every card as colorless without
erroring — the field names it checks had not changed, only the types behind
them. Each header table is now checked too, so the same skew refuses to load
instead.

**An added field has no safe order, though.** The check is exact: a client
refuses a file whose field list is not the one it reads. So uploading first
breaks the client that is live, and deploying first breaks on the file that
is. Being exact is what closed the colorless hole, and this is its other edge.

No single release resolves it — a client has to tolerate what it does not
know before there is anything unknown to tolerate. So the check reads the
names it knows off the front of what the file holds and ignores the rest,
which still catches a column that moved, and that has to be deployed and in
every browser before a file with a new column is uploaded. The table a
bitmask indexes is checked exactly as before: that is a meaning, not a
column list.

**A Pages deployment is a snapshot of one directory**, so a commit-triggered
deploy carrying the catalog would have to rebuild an artifact it has no
input for, and one that didn't would delete it. R2 is object storage: a new
pair uploads without removing the old, which is what lets a client mid-load
finish against the pair its manifest named.

Objects carry their own cache metadata, set per object at upload — `immutable`
for the content-addressed files, `no-cache` for the manifest, which is the
only part re-fetched. The client re-reads it on load, every six hours, and
when a backgrounded tab comes back after an hour — a machine that was asleep
fires no timers. It compares filenames rather than the version, because a
rebuild of the same Scryfall file can order printings differently and so
produce different bytes. Pages declares caching in a `_headers` file instead, and
gives a request the headers of *every* matching rule with same-named ones
comma-joined, so overlapping patterns there would say `immutable, no-cache`.

An R2 custom domain caches only certain file types by default and JSON isn't
among them, so it needs a cache rule. Files upload uncompressed for the CDN to
compress.

**The two policies cost differently, and only one of them grows with users.**
A content file is answered by the edge once it is warm, so the bucket sees it
about once however many clients load it. The manifest revalidates instead —
`cf-cache-status` says `REVALIDATED` on every request, measured against the
deployed bucket — so each read travels there rather than stopping at the
edge. Whether Cloudflare charges a revalidation as a read is not something
their pricing page says, which is the first thing to confirm from the bucket's
own metrics. Everything the server does is a fixed handful per run; this is
the only figure that rises with the number of people using the app.

At eight reads a day an active client comes to roughly 240 a month, against a
free allowance of ten million, so `no-cache` stays: it is the conservative
choice and the manifest is the one thing that tells a client the catalog has
moved. **Watch the operation count rather than the bandwidth** — egress is
free and the bytes are cached, so operations are the axis that moves, and the
bucket's own metrics are where to read it. The lever, when it starts to
matter, is a short `max-age` instead: five minutes of edge caching would
collapse every client in that window into one read, and five minutes of
staleness is nothing against a weekly rebuild, the more so because what a
prune removes has been unnamed for a day by then.

**The server uploads its own catalog**, through `crates/objects` and an R2 API
token it reads from the environment. The token is scoped to the one bucket and
wants object read as well as write, the skip below being a HEAD. Its secret
access key is the SHA-256 of the token value, which R2 shows once — so losing
it costs a hash of the value rather than a new token.

The host runs a container image and holds no checkout, so there is no `just`
and no wrangler out there to call — a dev tool is not a production runner.
`manaweb-upload` is the same library behind a binary, for pushing a set by
hand, which is what `just upload` runs: a second implementation for local use
would be the one nobody exercises until the weekly job fails.

It publishes after a sync and again at startup, so restarting the service is
how an upload that failed gets retried. A pair whose name is already in the
bucket is left alone, the names being content-addressed, so that retry costs
one HEAD rather than 12MB. A manifest nobody changed is left alone too, which
matters for the reason below rather than for the write it saves.

**Taking the replaced files away happens first, before the new ones go up.**
Read the other way round it sounds backwards, but the manifest in the bucket
at that moment is the one clients have been handed, so everything it omits
was superseded a cycle ago and has had a week to go quiet. Pruning afterwards
would instead take the generation a client was handed seconds earlier.

A cycle is only as long as the gap between runs, though, and a restart makes
that gap minutes. So nothing is taken while the manifest is under a day old,
and that is why an unchanged one is never rewritten: each rewrite would push
the clock back, and a service restarting daily would leave the bucket growing
with nothing in the log to say why.

Two origins also means every catalog fetch is cross-origin, so the bucket
needs a CORS policy. `Access-Control-Allow-Origin: *` is right: the catalog is
public data derived from Scryfall, whose own API sends the same. `just serve`
sends it too, or the dev loop fails at the first fetch and only in a browser.

## What the browser holds, and what it is allowed to reach

Three caches, and they are not the same thing. IndexedDB holds the catalog,
which is megabytes on the other origin and the reason manual search costs no
round trip. The HTTP cache holds the hashed assets for a year, which
`_headers` says. The service worker holds the shell — the document, the two
hashed files, the icon and the web app manifest — so a reload deep in the app
works with no network at all.

It deliberately holds nothing else. Caching the catalog there would be a
second copy of what IndexedDB already has, under a policy that cannot see
whether the manifest moved. Every route is the same document, so a navigation
falls back to `index.html`; the hashed files are read from the cache first
because nothing can change under those names; everything else is fetched and
only falls back. The cache is named for a hash of the shell it holds, so a
deploy takes the whole of the last one rather than expiring entries.

### What stays in memory, and what is fetched when asked

Bytes on the device are not the constraint; what the rows cost once parsed is.
The pair is 12.9MB stored, and measured at 88MB resident on 2026-09-21 when it
was 12.5MB, because every row becomes a JavaScript array of JavaScript
strings. Roughly five times
its own size for the cards, six for the printings, and a further 19MB for the
name index built over them.

**Columns the query filters on are already integers**, so those belong in
typed arrays: set, rarity, layout, language, finishes and the flag word come
to 1.1MB across every printing, against 46.5MB for the same rows as objects.
Holding the strings beside them as one run of UTF-8 bytes with an offset array
brings that file to 5.8MB and the cards, which are the same shape, to 4.4MB.
The pair is then smaller in memory than the file it came from, and filtering
gets quicker rather than slower because the hot loop stops chasing pointers.
Those figures were taken against the same 2026-09-21 pair; faces, keywords and
the art column have been added since, and only a browser can say what they
cost resident.

The cost is at load: parsing the file whole and then building columns peaks
higher than either, so the file is read in slices of rows instead. It is an
array of arrays and the row boundaries are findable, which is a reader rather
than a parser. The slices are bytes: decoding the file to text up front would
cost as much again as the rows the reader exists to avoid.

**Residency follows the access pattern, not the file.** A search scans, so
what it scans has to be resident. Everything else is asked for:

| | pattern | where it lives |
|---|---|---|
| filter columns, names | scanned every query | memory, as typed arrays |
| printings past the first | one card at a time | bytes, parsed per run |
| card text | the card being read | a store, keyed by card |
| scanning a printing | a lookup per card | a store, keyed by set, number and language |

The last one is what would make scanning every language affordable, and it is
the row nothing has built: there is no such store and no call to Scryfall's
API anywhere in `web/`. Resolving a printing is a point lookup, which is what
an indexed store is for, so it would never occupy memory at all — the
difference between 206MB resident and none of it.

`_headers` also carries the CSP. Pages is the only thing that reads that file,
which would leave the dev server the one place the policy is not enforced, so
the dev server parses it and sends the same headers. A policy that only
production has is a policy found in production.

## Preview deployments

Two Pages behaviors decide what a preview can do:

- A custom domain attaches to a **branch**, so `dev.manaweb.app` serves the
  `dev` branch and a login callback sits on a host we control.
- Pages **does not build previews for pull requests from forks**, so only
  someone with push access can produce a preview host.

Per-commit URLs can't take a login: their hostnames aren't predictable, so no
callback can be declared for them in advance. Reach the `dev` preview by its
custom domain, which is the one that has one. The OAuth side is in
[`atproto.md`](atproto.md).

That is also why Pages rather than Workers with static assets, which Cloudflare
otherwise points new projects at: branch aliases there are listed as coming
soon, so a preview would be a second Worker wired up by hand instead of a
branch that deploys itself. Their own migration guide calls the move
straightforward, so this is a decision to revisit rather than live with.

**Previews read and write production data.** A parallel NSID namespace would
be permanent once records existed, would be declared in the scopes every user
consents to, and would leave junk in people's repos. Isolation, when wanted,
is a second account.

## Storage: why SQL

Document storage is atproto's job — PDSes hold the records. Ours is an *index
over* them, and indexes want to be relational. We're choosing a store for
queries, not documents, and the queries are joins, aggregates and point lookups
with secondary indexes. An embedded KV store means hand-rolling every index
with no query language; a document server contradicts the single-process
decision.

Two SQLite specifics earn their keep. **FTS5** gives full-text card name search
free, which is the server-side fallback a client-only design otherwise lacks.
**JSON columns with indexed generated columns** handle the semi-structured
part: `card_faces` is irregular, so store it as JSON and generate columns for
what's queried. An unexpected Scryfall shape then doesn't silently null a
column.

Keeping whole card objects would put the bulk file's uncompressed bulk on a
small VPS disk — and several gigabytes of it if All Cards ever lands. Shred
what's queried, keep `card_faces` as JSON, discard the rest.

Measured on 2026-09-18: the cache shreds to an 88MB file including the FTS5
index, written in seconds — [`scryfall.md`](scryfall.md) holds the row
counts. Two columns earn normalizing. Legalities repeat ~480 bytes on every
printing for only 613 distinct combinations, which inline was 47% of the
database; the rest of what
a card's rules say is its own table, for the reasons in
[`scryfall.md`](scryfall.md). The sync truncates the WAL when it commits,
which otherwise sits at roughly the size of the database again.

The connection pool is sqlx's default ten, and measuring it changed nothing. An
idle pooled connection holds no read snapshot and so defers no checkpoint; a
streaming query holds one until its last row, and the catalog build streams.
They never overlap — a refresh syncs, then exports — and there is only ever one
writer, so the five-second busy timeout has nothing to expire against. Measured
on 2026-09-16 across a full replace: reads through the pool took 1.6ms at worst
and none failed while the write was open.

**The export reads its order rather than working it out.** A printing carries
where it sits in the artifact, written at sync, because deriving it at export
time meant a join onto oracle and a temp B-tree that every selected column of
every row passed through.

Asking the database to hand them back in that order is barely better, an index
scan paying a row lookup each. So the table is read start to end in one pass
and put in order here. Measured 2026-09-22 against the full cache, the three
in turn: 1.64s, 1.08s and 0.80s, at 33MB, 30MB and 78MB resident.

The last of those reads as expensive on a 950MB host and is not. Measured the
same day: the container idles at 8MB, the host has 600MB free, and the sync an
export follows peaks higher anyway, at 109MB. It lasts as long as an export.

**Phase 3's non-derivable state gets a file of its own.** Everything in the
cache derives from Scryfall, which is what makes it disposable; one thing
arriving with Explore won't, being activity we only ever saw go past. A record
written and deleted between two of our reads leaves nothing behind to re-read,
and the replay window bounds how far a reconnect recovers. Put that in a second
SQLite file rather than adding tables to the cache — free now, a schema split
later — so any durability it needs applies to a small file rather than the
derived one.

The accounts we index are not that. A collection filter is network-wide, so a
DID arrives with the first record it writes; a table of them is an index for
backfill, rebuilt by the next thing each account writes, rather than the
subscription's input.

What that durability is stays open. An R2 object snapshot is the cheap answer
and we upload the catalog there anyway. Litestream is the obvious tool and a
bad fit for the *cache*: it wants `wal_autocheckpoint = 0` and takes a full
snapshot whenever anything else checkpoints, which the sync does deliberately.
Against a small file nothing bulk-rewrites it would be a fair candidate, but
so would something else — decide it when there is data to lose.

## Server load & scaling

With search, scanning and import/export client-side, almost nothing is
per-user; fixed periodic jobs dominate. In v0 the AppView doesn't even watch
the firehose. Per-user cost is a few index rows and a trickle of events —
nobody edits a collection thousands of times a day. What scales is bandwidth
for static artifacts, which a CDN fixes cheaply.

- Client artifact: a few megabytes over the wire, sized in
  [`scryfall.md`](scryfall.md). Served by a CDN rather than
  by us; the shape is in [`scryfall.md`](scryfall.md).
- Scanner index: 1.70MB over 54,585 artworks, both sides of a card, 1.40MB on
  the wire, measured 2026-09-23. Embeddings would be ~25MB, still an estimate.
- Weekly deltas have no mechanism yet — computing them means keeping a previous
  catalog snapshot server-side, which sits awkwardly with a disposable DB.
- Bucket operations, not bandwidth, are what a growing user base spends: the
  manifest is read past the cache and the artifacts are not. Roughly 240 reads
  a month per active client, against ten million free.

| Users | Shape |
|---|---|
| 1-5 | Box is idle. Cost is the fixed sync jobs. Current VPS is oversized. |
| 50 | Still idle. ~2-5GB/month transfer. Nothing per-user held in RAM. |
| 500 | 15-50GB/month, inside the 1-2TB included. DB 1-2GB. Still 1 vCPU. |
| 5000+ | Bandwidth first, solved by a CDN. Process shape doesn't change. |

Two hazards, both memory-shaped on a 1GB box: the bulk sync must stream JSONL
line by line, and the scanner index build must not run on the VPS at all.

What would break flat costs, likeliest first: a server-side scanner fallback,
Explore's network-wide indexing, then price history's unbounded storage.

- Cache the catalog in IndexedDB so manual search is client-side, not a
  round-trip per keystroke. Biggest lever for keeping the server light.

## If atproto goes away

Not building this now, but the seams cost nothing and are decent design anyway.
Standalone mode is a *smaller* system: if the server owns the data the firehose
disappears rather than needing a replacement, and OAuth becomes session auth.
The risk isn't build effort later, it's atproto concepts leaking where they
don't belong.

- **`crates/core` compiles with no atproto dependency.** Domain types carry
  `scryfall_id`, quantity, finish, not at-uris and CIDs.
- **Identity is an opaque internal id**, with DID as one mapping in a `users`
  table, rather than DIDs through the schema.
- **Indexing is a function, not a pipeline.** Write it as "given a record and
  its metadata, upsert" so a direct write can call it, not only Jetstream.
- **The client needs the same seam**, since it holds the write path. It needs a
  data-access layer anyway to handle reads-from-AppView alongside
  writes-to-PDS.
- **Don't contort the lexicons for it.** `forkedFrom` as an at-uri is correct
  in atproto; a standalone adapter can map it.

Eventually an installation flag, suiting the single-binary deploy. Standalone
loses portability and everything social, so it's a lifeboat, not a goal — worth
launching only if atproto turns sharply for the worse. Browser-writes raises
the transfer cost slightly, since the write path would move back to the server.

## A long job only runs while a tab is open

No web API lets a page schedule its own code for a time of its choosing. The
four ways anything runs without one are all scheduled by the browser instead:
background sync fires on connectivity, periodic sync on a cadence it picks
behind an install requirement, background fetch starts everything at once, and
push needs a server to send it. Three are Chrome-only, and on iOS the content
process is suspended outright when Safari goes to the background, so there is
nothing to schedule into. A service worker is no help either: its longest
documented budget for a single event is five minutes, shorter than one gap
between two write batches.

So an import is not kept alive. It is made cheap to lose:

- **Deadlines are instants, not delays.** Every wait is stored as the moment it
  ends, so a tab that was throttled, frozen, discarded or asleep reads the same
  deadline on waking. Timer throttling and machine sleep stop being correctness
  problems and become lateness, which the pacing already tolerates.
- **A short tick reads the clock**, rather than one long timer being trusted to
  fire. Chrome floors a hidden tab's wake-ups at one a minute, which costs a
  minute; a seven-minute timer fires whenever it likes after a sleep.
- **The repo is the truth, and the device holds only what has not reached it
  yet.** Once the parts are uploaded there is no local state worth protecting:
  what is left to write is what the repo still lists, so clearing the browser,
  changing device or signing in somewhere new all resume the same import.
- **Resumption is a consequence of opening the app**, not of finding the page
  that started it. Which also means the runner cannot live in a component: a
  route change would end the import.

The daily ceiling makes this the normal case rather than the exception. At
11,666 creates a day a large collection spans days, so an import surviving a
browser restart is the ordinary path through the feature. What that costs a
person is now only whether their cards have finished sorting themselves out,
rather than whether their collection made it off the device at all.

**Elapsed time is not attended time.** An hour's budget is eight `applyWrites`
calls, so what an import actually needs is the app open for the seconds those
take, six times, an hour or more apart. Batches therefore run back to back
while the budget allows rather than one per tick — the difference between
sixteen seconds of someone's attention per window and three minutes of it.
Quoting the elapsed figure as though it were the ask is what makes the feature
sound unusable.

Which means the collection has to show the truth while that is going on. The
runner hands each landed batch to the collection rather than letting it re-read
the repo, so what has been written appears as it is written and a half-finished
import looks half-finished. A read started before a batch landed would answer
with a view from before it, so anything written since is laid back over the
answer. And a stopped import says so from every page: it is the one state
nothing else would ever mention again, which is how someone ends up believing a
collection synced when it stopped at a third.

## Open questions

**Jetstream is unauthenticated.** It doesn't verify signatures. Fine for our
own DIDs; a real trust assumption once Explore indexes arbitrary users.

**The bucket keeps more than it serves.** A prune only reaches what the last
upload replaced, so a generation older than that stays. The box reported
fourteen objects kept against the three a client fetches, which is nothing at
this size and is not bounded by anything either. Deciding what bounds it wants
a rule about how long a client may be mid-load, which nothing has needed yet.

**The export is built whole before any of it is written.** Both files sit in
memory as bytes, 12.9MB together, then go to disk and are read back by the
upload. That grew with faces and grows with whatever comes next, and a writer
streaming to the file would make it flat. Worth doing when a part is added,
not before.

**The faces query is the slowest statement in an export.** 1.01s on the box,
reading 2,315 rows, because it orders by a `json_extract` over every printing
that has faces. An index on `oracle_id` for those rows would probably settle
it; nobody has tried.
