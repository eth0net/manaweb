# Manaweb

Personal/hobby project: an atproto-based Magic: The Gathering collection
tracker, scanner, and deck builder. MTG-first, designed not to paint into a
corner if other TCGs are added later.

Not a business. Running costs look light enough they may never need funding.
WotC's Fan Content Policy, Scryfall's API terms and EDHREC's terms constrain
what can be *built*, not only what can be charged for.

`docs/` carries the reasoning, one file per subject: `roadmap.md` for phases,
`data-model.md` for owned versus referenced and history, `architecture.md` for
the AppView shape and storage, `scryfall.md` for the cache and the client
artifact, `search.md` for querying it, `atproto.md` for lexicons and the PDS
and OAuth limits, `ip.md` for the WotC and Scryfall constraints. This file is the condensed orientation for
picking the project back up; each crate describes itself in its `Cargo.toml`.

Prose here and in `lexicons/` is read more often than it is written, so keep it
short: the non-obvious fact and its one consequence. Two lines of comment is a
lot, and the second is usually the justification `docs/` should carry. That cap
is on plain `//` notes; `///` and `//!` are the cargo docs and earn the room,
and TypeScript has neither marker, so a comment there is always a note. Write
it that way first rather than trimming after — `just prose` fails on any eight
words a comment shares with a doc, or one doc with another, because prose said
twice drifts apart and figures said twice go stale. Lexicon descriptions say
what a field is, never why — measured against Bluesky, WhiteWind and Leaflet,
real ones run to a median of 48 characters and Leaflet describes no fields at
all. Reasoning belongs in `docs/`.

Deferred work is marked at the line it affects. `todo(<the thing>)` waits on
something that does not exist yet — `todo(settings)`, say — and carries its
reasoning in the matching doc's open questions. `todo(eth0net)` names whoever
owns it, where that is a person rather than the code. A bare `todo:` is a fix
nothing blocks and nobody owns, so prefer giving it an owner over leaving it —
searching for one form finds a person's work, another a feature's, and `todo`
alone finds every one of them before a release.

Spelling is American, matching the vocabulary the code already uses. `typos`
enforces it; `typos.toml` says what it skips.

## Core architecture

This is an **AppView** in atproto terms, not a normal app-owns-its-data
backend:

- **User data** (collection entries, decks, eventually shared/published state)
  are atproto records written to *the user's own PDS*, not our database. We
  don't host user data.
- **The browser writes directly to the user's PDS** using its own OAuth
  session. Our server never proxies a write and has no write handlers for user
  data. OAuth is a browser-side public client (PKCE + DPoP); the `client_id` is
  the URL of a static client metadata document we serve.
- **Our server** ("the AppView") is a single Rust process that: (1) syncs
  Scryfall card data into our own DB as a cache, (2) exports the catalog from
  that cache for a CDN to serve, (3) from Phase 3, consumes a filtered
  Jetstream firehose to index *other people's* published records. It never
  touches the app itself, which Vite builds from the repo.
- **Everything a browser fetches is static, on two origins.** The app and the
  OAuth client metadata document deploy from the repo to Pages on commit; the
  catalog uploads to R2 on its own subdomain when Scryfall moves. Separate
  because a Pages deployment is a snapshot of one directory, so one deploy
  would delete what the other produced.
- **v0 doesn't need the firehose at all.** The client reads its own records
  straight from its own PDS (`listRecords`), so the PDS is the sync mechanism
  between a user's devices. That read is cached for a first paint but still
  costs 84 round trips to settle — see `docs/architecture.md`.
  Indexing only earns its place when we need what the client can't do locally —
  Explore, cross-user aggregates.
- **Our database is disposable.** Everything in it derives from Scryfall or
  from records we can re-read from PDSes; tokens live in the browser. One
  exception arrives with Phase 3: activity history only ever seen over the
  firehose, a record written and deleted between two reads leaving nothing in
  the repo to find.
- Bias toward flexibility in the DB/AppView layer; be conservative about
  lexicon NSIDs and required fields, since those are costly to change once real
  records exist in other people's repos.

## Data model

- Card print cache from Scryfall's **Default Cards** bulk file (~78MB
  compressed, gzipped JSONL — stream it, never parse whole). Refresh weekly,
  per Scryfall's own guidance.
- Default Cards omits most non-English printings — 652 Japanese, 9 German — so
  **a CSV import of a non-English collection can't resolve its print ids** and
  All Cards (392MB) is a v0 need, not a Phase 3 one. Display can wait: the
  client resolves a printing on demand from Scryfall's API (CORS is `*`, 48h
  cache-control) into IndexedDB. See `docs/search.md`.
- Don't store images or image URIs — hotlink Scryfall's CDN, deriving URLs from
  the card id. Keep `image_status`.
- **The cache is two tables.** `oracle` holds what the rules see, one row per
  card, verified constant across printings; `cards` holds one physical
  printing each. `legalities` and `layout` stay per printing. The split also
  fills in reversible printings, which carry no top-level gameplay data.
- **Card objects aren't uniformly shaped.** `layout: reversible_card` has no
  top-level `oracle_id`, `cmc`, `mana_cost`, `type_line`, `oracle_text`,
  `colors` or `image_uris` — those live on `card_faces`. So `oracle_id` can't
  be `NOT NULL`, and the cache needs `layout` and `card_faces`.
- **Scryfall taxonomies stay strings** in `crates/scryfall` — `layout`,
  `rarity`, `set_type`, `finishes`, `games`, `legalities`. New values appear
  unannounced and must not fail an unattended sync. Colors are typed; the
  rules close that set.
- **The client artifact is two files under one version**: cards, and paper
  printings grouped by card in the cards file's order. Written uncompressed
  for the CDN to compress. Positional rows with integer codes for
  low-cardinality columns. The base pair carries no oracle text or legality;
  text is an opt-in part, because offline card viewing wants it and collection
  tracking does not.
- Price cache: **separate table**, keyed by `scryfall_id` + source + timestamp.
  Not built — nothing writes it before Phase 2, so the schema would be dead.
  Note there is **no prices bulk file** — prices exist only as fields inside
  card objects, so a faster price cadence has no cheap mechanism. Cadence is an
  open question for Phase 2.
- **Import speed is the Phase 0 constraint, but not the upload's.** A PDS
  allows 1,666 record creates an hour and 11,666 a day, hardcoded rather than
  configurable (`applyWrites` caps at 200 per call and is charged per write; a
  create costs 3 of an hourly 5,000-point budget). Stacks measured at 70% of
  cards, so 11,839 cards is 8,321 records and five hours. A file therefore
  lands as `app.manaweb.import` parts first — 42 of them, 1.89MB, three calls —
  and drains into cards afterwards. `importRepo` can't shortcut either.
  Elapsed time is not attended time — see `docs/atproto.md` and
  `docs/architecture.md`.
- Collection entries reference `scryfall_id` (exact print), not `oracle_id` —
  we track specific physical cards (set/collector number/finish), same as
  ManaBox.
- **Owned vs referenced is the core split.** A *collection entry* is a card you
  own, in exactly one *container* (binder, box, deck box). A *design* — deck or
  list — is card references you may or may not own; a wishlist is a design with
  no deck metadata.
- "Built" is not stored. It's derived, and **scoped by whether the deck has a
  container**: with one it means "how much is physically in that deck box",
  without one it means "do you own enough copies anywhere". No setting needed.
- Design entries carry `oracle_id` (required) and `scryfall_id` (optional).
  Rules reasoning — legality, EDHREC — keys on `oracle_id`; display and flavor
  key on the print. Omitting the print means "any printing". Deck and list
  entries share one shape via a lexicon `defs` ref.
- Collection entries are one record per stack; deck contents are an embedded
  array in the deck record. A 10k-card collection can't be one record, a
  100-card deck shouldn't be 100.
- **A print id already pins the language.** Every language of a printing has
  its own Scryfall id (m10 #146 has nine), so collection entries carry no
  `language` field — it would only ever contradict the id.
- Lexicon NSIDs are rooted at `app.manaweb.*` (from `manaweb.app`) and carry
  **no game segment**: `app.manaweb.card`, not `app.manaweb.mtg.card`. Manaweb
  is an MTG app; a segment for a game that may never exist would sit in every
  record forever. A second TCG would be a fork sharing extracted libraries,
  not a branch of this namespace.

## Firehose strategy (Phase 3, not v0)

- Not needed for v0 (see Core architecture). Building a consumer earlier means
  writing it for records nobody has created yet.
- When it lands: `wantedCollections` scoped to our own NSIDs, network-wide, for
  published/explore decks — cheap, because only Manaweb users ever match
  those collections.
- **Discovery needs no DID list.** A network-wide collection filter means
  anyone writing one of our records announces themselves.
- Use Jetstream's time-based cursor for reconnects; keep indexing idempotent.
- Jetstream doesn't verify signatures — it's a convenience relay, not the
  authenticated firehose. A real trust assumption once we're indexing arbitrary
  users.

## Stack decisions (already made — don't re-litigate without reason)

- **Rust** workspace: `axum` (API), `sqlx` (SQLite — not Postgres, not
  Pocketbase; chosen over rusqlite for built-in migrations and async fit),
  `tokio`, `tokio-tungstenite` (Jetstream websocket). Use runtime-checked
  `query()` while the schema churns; adopt `query!` once it settles.
- **SQLite**, single file, single process. No separate DB server.
- **Frontend**: TypeScript, built with **Bun** (not npm), lives in `web/`. PWA
  with a service worker — client-side caching (IndexedDB) of the card catalog
  is core to keeping server load light, especially for manual search.
- **Deploy**: Pages for the app, R2 for the catalog, which **reverses the
  earlier `rust-embed` decision** — there is nothing to embed, and Bun never
  enters a Rust build at all. The binary writes a catalog directory
  (`MANAWEB_CATALOG`); uploading it is a separate step. Still a `justfile`
  rather than `build.rs`, for the same reason as before.
- **Local dev**: frontend runs its own dev server (`bun run dev`, hot reload)
  fetching the catalog from the binary's site directory. Nothing has to be
  built into anything.
- **Hosting**: existing Vultr VPS, 1 vCPU / 1GB RAM. Sufficient for
  single-user/small-friend-group scale given the filtered-firehose approach —
  the Scryfall bulk-data refresh is the bigger periodic resource event to
  watch, not the firehose.

## Build order (where we are / what's next)

1. **Done** — workspace scaffold, and `crates/scryfall`: bulk-data index,
   streaming NDJSON reader, card parse. Offline fixture tests plus an example
   that streams the real file.
2. **Done** — card cache in `crates/core`: migrations, a full-replace sync
   fed by a `CardStream`, FTS5 name search, printing lookup for CSV import.
   81MB for 117,630 printings. `legalities` is a lookup table, not a column.
3. **Done** — lexicons enumerated in `lexicons/`, validated in CI against
   atproto's own implementation plus records that must be refused.
   Deck, list and snapshot precede their implementation deliberately: the
   design entry and collection entry interlock, so the join wants settling
   together.
4. **Done** — the `manaweb` binary. Exports the content-addressed catalog
   and its manifest from the cache, serves them for local development, and
   refreshes the cache weekly. Configured from the environment; `just serve`.
   The OAuth client metadata document is committed at
   `web/public/oauth/client-metadata.json`, not generated.
5. **Done** — the web client: OAuth, reads from own PDS, writes back, and
   imports a CSV, parsed and planned against what is held, then landed whole
   and drained into records at whatever the PDS will take. Measured end to end
   against a limited one. Deployment is what v0 still wants of it.
6. Fixture records seeding a dev account without the UI. `goat` is the atproto
   CLI and already writes them from an app password, so what is left is a
   directory of JSON and a `just` recipe rather than a program.

Jetstream and the query API arrive with Phase 3 (Explore), not before. That
API is XRPC, and nothing else is — see `docs/atproto.md`.

v0 scope is deliberately narrow: **collection tracking only** — manual search +
CSV import, no scanner, no live pricing yet. Scanner, valuation, EDHREC assist,
shared/published decks + explore, and the game toolkit (life
totals/dice/history) are later phases — see `docs/roadmap.md`.
