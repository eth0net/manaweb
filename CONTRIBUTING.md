# Contributing

Manaweb is pre-v0: the collection tracker runs end to end, and everything
after it is in [`docs/`](docs/roadmap.md). The most useful contribution is a
second opinion on the lexicon shapes, before records exist in other people's
PDSes — that's the part expensive to change later.

## Getting set up

Rust (stable, 2024 edition), and [Bun](https://bun.sh) if you're touching
`web/` or `tools/`.

```sh
git clone https://github.com/eth0net/manaweb
cd manaweb
prek install
cargo test
```

`just hooks` installs them. [prek](https://github.com/j178/prek) runs what CI
runs — `cargo fmt`, a
warning-free `cargo clippy --all-targets --all-features`, `cargo test`,
`biome`, `tsc`, `bun test`, `typos`, the prose check and the sign-off check —
on commit and push, so a red build costs no round trip. The Rust and
TypeScript hooks are scoped by path, so touching one side never asks for the
other's toolchain. CI runs what a checkout cannot: the macOS and Windows
matrix and the oldest Rust we support.

One hook is git's own rather than prek's. A tag-only push runs no hooks at
all, so `reference-transaction` refuses a `v*` tag the manifest disagrees
with, before the tag exists — `just release` is the way to cut one, and CI
checks the same thing for a tag pushed from somewhere without hooks. It takes
the title the tag is annotated with, since a release that cannot be named in a
few words is probably two.

Spelling is American, because the vocabulary already is: `color`, `license`,
`serialize`. `typos` enforces it, and `typos.toml` says what it skips —
captured Scryfall fixtures, license text, and translations when they arrive.

[just](https://github.com/casey/just) holds the whole workflow — `just check`
runs the checks a checkout can, `just serve` starts the server, and
`just --list` shows the rest. Every recipe names the one toolchain it wants,
so `just rust` needs nothing but cargo and `just ts` nothing but bun.

Tests are offline, against Scryfall responses captured under
`crates/*/tests/fixtures`. The parts that talk to Scryfall are examples, run by
hand, since they pull ~78MB from a free service:

```sh
cargo run --release -p manaweb-scryfall --example stream  # parse only
just sync                                                    # into the cache
```

Keep the bulk file and pass it to `just sync` as an argument, so iterating
doesn't re-download it. `just catalog` then builds the client artifact from
whatever the cache holds, and needs no network at all.

## Commits

Conventional commits. The subject carries it; explain *why* in the body only
when the diff doesn't. One logical change per commit.

Commits need a [DCO](https://developercertificate.org) sign-off, which
`git commit -s` adds:

```
Signed-off-by: Your Name <you@example.com>
```

It certifies you wrote the contribution, or that it came from somewhere
compatibly licensed and you have the right to submit it. No CLA, no copyright
assignment. Git has no config for it, so `prek install` adds a `commit-msg`
check; merge commits are exempt.

## Attribution

Developed with [Claude Code](https://claude.com/claude-code).

## Licensing

Contributions to the AppView are AGPL-3.0, and contributions to `lexicons/` are
MIT, each matching the code around them. Submitting a pull request agrees to
that. The split is deliberate — NSID schemas are shared vocabulary — and the
reasoning is in [`docs/ip.md`](docs/ip.md).
