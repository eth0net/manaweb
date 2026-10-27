# Tools

Everything here is TypeScript run by bun, whatever it is checking: a tool takes
the toolchain of what it consumes rather than of what it asserts about, so
`lexicon-check` runs atproto's own validator and `scryfall-check` drives the
client's own parser. A check that could live beside the code as a test does —
the catalog's format is a Rust test next to the exporter, not a tool here.

They divide by what answers them.

## Checks CI runs

Green here means green there. `just check` runs all four.

|                   | what it asks                                                           | recipe          |
| ----------------- | ---------------------------------------------------------------------- | --------------- |
| `lexicon-check`   | do the lexicons validate, and is a record that must be refused refused | `just lexicons` |
| `prose-check`     | does a comment repeat a doc's sentence, or one doc another's           | `just prose`    |
| `scanner-check`   | does the wasm engine answer what the native one does                   | `just scanner`  |
| `lex-gen --check` | do the generated record types still match the lexicons                 | `just lexicons` |

## The checks nothing runs for you

Both want something a checkout does not carry, so neither is in `just check`.

`scryfall-check` (`just scryfall-search`) holds our search to Scryfall's own
answers. It asks about the implementation rather than about a commit, and it
needs their service to answer at all.

`fixture-check` (`just fixtures`) holds the import fixtures to the catalog: the
printing a row names has to exist and the finish it claims has to be one that
printing was made in. `edges.csv` is left out, every row of it being one a
reader must refuse.

## Generators

These write files into the repo. Run one when its source moves, commit what it
wrote, and never hand-edit the output — a check will not catch you.

|           | what it writes                                                 | recipe                     |
| --------- | -------------------------------------------------------------- | -------------------------- |
| `icons`   | every raster and the `.ico`, from `web/public/icon.svg`        | `just write-icons`         |
| `lex-gen` | the record types the client reads records with                 | `just write-lexicon-types` |
| `seed`    | fixture records, into a dev account's PDS rather than the repo | `just seed <handle>`       |

## Not a tool

`hooks/` is a git hook installed by `just hooks`, not something bun runs. It
refuses a version tag the manifest disagrees with, which prek cannot do because
a tag-only push runs no hooks at all.
