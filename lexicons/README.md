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
| `app.manaweb.import` | Part of an import, holding cards not yet written |
| `app.manaweb.defs` | Shapes shared between designs — no records |

Deck, list, snapshot and import run ahead of their implementation; decks arrive
in Phase 3. They stay freely changeable until records exist, and none of them
is in the OAuth scope list until something writes it.

Why the shapes are what they are: [`docs/data-model.md`](../docs/data-model.md).

## Changing these

Additive optional fields are safe. Removing a field or adding a required one is
not — records live in repos we don't control. A new NSID is cheap, so prefer
one to widening an existing shape.

An array's `maxLength` has to describe a record a PDS will take, and a write
caps at 1,000,000 bytes. Where the item has a bounded size the ceiling can be
held to that: `designEntry` is at most 264 bytes, so 2,000 of them is 528KB and
the number means something. `entries` at 10,000 came to 2.65MB and could never
have been written.

Where the item is open-ended no count can promise anything — a card carries a
3,000-byte note, so a hundred of them fit and a hundred and twenty-five do not.
There the writer packs by measured bytes and the ceiling is a sanity bound
rather than a guarantee. Say which kind a `maxLength` is where it isn't
obvious, because a reader will otherwise take it for the guarantee.

## Checking them

```sh
cd tools/lexicon-check && bun install && bun run check
```

Every schema against atproto's own validator, then records that must be
accepted and records that must be refused.
