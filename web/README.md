# web

The client: TypeScript and React, bundled by Vite, run with Bun. Deployed to
Cloudflare Pages from the repo on commit.

    just serve-client   # the dev server, hot reloading
    just ts       # what CI runs: biome, tsc, bun test, vite build

The catalog comes from the other origin, so `just serve` has to be running
too: it exports the artifact from the cache and sends the
`Access-Control-Allow-Origin` the bucket has to send in production.
`src/config.ts` holds the two origins.

`src/catalog/` reads it — `load.ts` fetches, `store.ts` keeps the bytes in
IndexedDB under their content-addressed names, `rows.ts` finds the row
boundaries in them, `columns.ts` and `strings.ts` hold what it reads out,
`index.ts` answers questions of the pair, `search.ts` scans names and
`query.ts` parses the search syntax. Only `load.ts` touches the network or
IndexedDB, which is what leaves the format and the ranking testable under
`bun test`.

`public/oauth/client-metadata.json` is the OAuth client metadata document.
Vite copies `public/` into `dist/` verbatim, which is what serves it at
`/oauth/client-metadata.json` — the URL its `client_id` has to equal. The
client imports the same file for the scopes it requests.

Editing it is a protocol change, not a config change:
[`docs/atproto.md`](../docs/atproto.md) says what it has to keep saying, and
`bun run check` in `tools/lexicon-check` enforces it.
