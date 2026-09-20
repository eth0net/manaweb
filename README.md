# Manaweb

An [atproto](https://atproto.com) AppView for tracking a Magic: The Gathering
collection — your cards live as records in your own PDS, not in someone else's
database.

MTG-first. Collection tracking now; scanner, valuation, deck building and a
game toolkit later.

## Status

Pre-v0, and it runs end to end. `crates/scryfall` streams Scryfall's bulk
data, `crates/core` shreds every paper printing into SQLite, and the `manaweb`
binary exports the catalog a browser needs and uploads it. The client signs in
over OAuth, reads and writes records in your own PDS, imports a ManaBox CSV,
and searches the catalog offline with most of [Scryfall's query
syntax](docs/search.md). The lexicons are validated against atproto's own
implementation in CI, along with the OAuth client metadata document.

Not there yet: the scanner, pricing, decks and Explore. See
[the roadmap](docs/roadmap.md).

## Stack

- Rust workspace — `axum` API, SQLite and a Scryfall bulk-data sync, all in
  one binary. The Jetstream firehose consumer arrives with Explore.
- TypeScript PWA in `web/`, built with Bun and deployed to a CDN alongside the
  catalog artifact. Nothing a browser fetches comes from the binary.

## Layout

```
manaweb/
  crates/
    api/                 routes and handlers
    appview/             the `manaweb` binary
    core/                card cache, and the catalog it exports
    objects/             the bucket, and the `manaweb-upload` tool
    scryfall/            bulk-data fetch/parse
  docs/                  roadmap, and the reasoning behind each decision
  fixtures/              records that seed a dev account
  lexicons/              NSID JSON schemas
  tools/                 checks that span both sides, and the seeder
  web/                   the client, and its OAuth client metadata document
```

`just --list` is the whole workflow. [Configuration](docs/configuration.md)
lists what the binary and the tools read from the environment.

## Running it

The server needs no arguments and reads its configuration from the
environment — [`configuration.md`](docs/configuration.md) lists all of it.

```sh
docker run --rm -p 8080:8080 -v manaweb-data:/data ghcr.io/eth0net/manaweb
```

Tagged `X.Y.Z`, `X.Y` and `latest`, published from the tag it was built at.
`docker build -t manaweb .` builds the same image from a checkout.

`/data` holds the card cache and the exported catalog, owned by uid 10001, so
a bind mount has to be owned by that id to be writable. `ENTRYPOINT` is the
binary and `serve` is the default command, so `docker run manaweb version`
reaches a one-off without knowing where anything lives.

From a checkout, `just serve` does the same thing without the container.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits need a DCO sign-off
(`git commit -s`); there's no CLA.

## License

The AppView is licensed under [AGPL-3.0](LICENSE) — self-host it freely, but if
you run a modified version as a network service, your users get the source.

`lexicons/` is [MIT](lexicons/LICENSE) instead. NSID schemas are shared
vocabulary, and copyleft on a schema file would discourage the adoption that's
the whole point of publishing them.

The icon is the spider web from [Noto Emoji](https://github.com/googlefonts/noto-emoji),
Apache-2.0, recolored.

Card data and images come from [Scryfall](https://scryfall.com) under the
Wizards of the Coast Fan Content Policy. Manaweb is unofficial Fan Content
permitted under the Fan Content Policy. Not approved or endorsed by Wizards.
Portions of the materials used are property of Wizards of the Coast.
©Wizards of the Coast LLC.
