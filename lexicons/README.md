# Lexicons

atproto record schemas for Manaweb, rooted at `app.manaweb.*`. MIT rather
than AGPL like the rest of the repo — schemas are shared vocabulary. See
[LICENSE](LICENSE).

| NSID | One record |
|---|---|
| `app.manaweb.card` | A card you own, in however many copies |
| `app.manaweb.container` | A binder, box or deck box |
| `app.manaweb.deck` | A design with deck metadata, contents embedded |
| `app.manaweb.list` | A design without it — wishlist, trade pile, staging |
| `app.manaweb.snapshot` | A complete named copy of a design |
| `app.manaweb.defs` | Shapes shared between designs — no records |

Deck, list and snapshot run ahead of their implementation; decks arrive in
Phase 3. They stay freely changeable until records exist.

Why the shapes are what they are: [`docs/data-model.md`](../docs/data-model.md).

## Changing these

Additive optional fields are safe. Removing a field or adding a required one is
not — records live in repos we don't control. A new NSID is cheap, so prefer
one to widening an existing shape.

An array's `maxLength` has to describe a record a PDS will take. A write caps
at 1,000,000 bytes, so a ceiling is only honest if the array at that length,
holding items at *their* ceilings, still fits — `entries` at 10,000
`designEntry` came to 2.65MB and could never have been written.

## Checking them

```sh
cd tools/lexicon-check && bun install && bun run check
```

Every schema against atproto's own validator, then records that must be
accepted and records that must be refused.
