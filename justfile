# The whole workflow, so `just --list` beats remembering which toolchain each
# step wants. Every recipe is a plain command underneath.

db := env("MANAWEB_DATABASE", "manaweb.db")

[private]
default:
    @just --list

[private]
deps:
    @bun install

# every check CI runs that can run on one machine
[group('checks')]
check: rust deny spell prose lexicons ts

# the Rust side, needing nothing but a cargo toolchain
[group('checks')]
rust: fmt-check lint test

# format in place
[group('checks')]
fmt:
    cargo fmt --all

[private]
fmt-check:
    cargo fmt --all --check

# clippy, warnings denied as CI denies them
[group('checks')]
lint:
    cargo clippy --locked --all-targets --all-features -- -D warnings

# the Rust test suite, optionally filtered: `just test search`
[group('checks')]
test filter="":
    cargo test --locked --all-targets {{ filter }}

# spelling, at the version prek pins (needs prek)
[group('checks')]
spell:
    prek run --all-files typos

# advisories, licenses, duplicate versions and crate sources (needs cargo-deny)
[group('checks')]
deny:
    cargo deny check

# prose said twice: a comment restating a doc, or a doc another (needs bun)
[group('checks')]
prose: deps
    cd tools/prose-check && bun run check

# Deliberately outside `check`: it asks whether our search agrees with the
# syntax we borrowed, which is a question about the implementation rather than
# about a commit, and it needs their service to answer.
[doc("hold our search to Scryfall's answers (needs bun, network, a catalog)")]
[group('checks')]
scryfall-search: deps
    cd tools/scryfall-check && bun run check

# validate the lexicons against atproto's own implementation (needs bun)
[group('checks')]
lexicons: deps
    cd tools/lexicon-check && bun run check
    cd tools/lex-gen && bun run gen --check

# prek's own installer, which reads the hook types out of `prek.toml`. Here
# because `just --list` is the index, and a contributor who has to be told the
# command separately is one the index failed.
[doc('install the git hooks (needs prek)')]
[group('dev')]
hooks:
    prek install

# The drawing is the source and every appearance is a row of four colors in
# it, so a raster is composed rather than drawn — see `docs/roadmap.md`.
[doc('rewrite the app icons and favicons from icon.svg (needs bun)')]
[group('dev')]
write-icons: deps
    cd tools/icons && bun run icons

# rewrite the record types the client reads records with (needs bun)
[group('dev')]
write-lexicon-types: deps
    cd tools/lex-gen && bun run gen

# lint, typecheck and test every TypeScript in the repo, then build the
# client. The tools import the client's own modules, so one scope covers both.
[doc('lint, typecheck and test the TypeScript (needs bun)')]
[group('checks')]
ts: deps
    bun run check

# Both default to loopback; pass 0.0.0.0 to either to reach it from a phone.
[doc('export the catalog and serve it for local development')]
[group('dev')]
serve bind="127.0.0.1:8080":
    MANAWEB_DATABASE={{ db }} MANAWEB_BIND={{ bind }} cargo run -p manaweb-appview

[doc("the client's dev server, fetching the catalog from `just serve`")]
[group('dev')]
serve-client host="127.0.0.1": deps
    cd web && bun run dev --host {{ host }}

# Pulls at Scryfall's own 100ms and keeps every image, so a rebuild costs the
# hashing rather than the download. Hours the first time, minutes after.
[doc('pull the artwork images the scanner index is built from (~4GB)')]
[group('dev')]
pull-art dir="scryfall/art":
    cargo run --release -p manaweb-scan -- pull {{ db }} {{ dir }}

# What the index retrieves once a query has been through what a camera does to
# an artwork. Reads whatever `pull-art` has fetched so far.
[doc('report what a degraded query retrieves from the artwork index')]
[group('dev')]
measure-art dir="scryfall/art":
    cargo run --release -p manaweb-scan -- measure {{ db }} {{ dir }}

# sync the card cache from Scryfall (~78MB), or from a file already on disk
[group('dev')]
sync-cards file="":
    cargo run --release -p manaweb-core --example sync -- {{ db }} {{ file }}

# build the client artifact and report its size, writing it to a directory
[group('dev')]
build-catalog dir="":
    cargo run --release -p manaweb-core --example catalog -- {{ db }} {{ dir }}

# `goat` holds the session and does the writing; the recipe only says what.
[doc('seed a dev account with the fixture records (needs bun and goat)')]
[group('dev')]
seed handle dir="fixtures/records": deps
    cd tools/seed && bun run seed {{ handle }} {{ dir }}

# Needs a deployment rather than a checkout, which is why it is not in `check`.
[doc('fetch a deployed client metadata document and hold it to its own URL')]
[group('deploy')]
verify-oauth url="https://manaweb.app/oauth/client-metadata.json":
    cargo run --release -p manaweb-objects --bin manaweb-verify -- oauth {{ url }}

# The same upload the server runs after a refresh, so a bug in it cannot wait
# for the weekly job to show itself. Credentials come from the environment.
[doc('upload the catalog the manifest names to its bucket')]
[group('deploy')]
upload prefix="catalog" dir="catalog":
    cargo run --release -p manaweb-objects --bin manaweb-upload -- {{ prefix }} {{ dir }}

# Needs the bucket's custom domain, whose CORS and cache rules are set in
# Cloudflare rather than on an object, so a checkout cannot answer for them.
[doc('fetch a deployed catalog and hold it to the headers a client needs')]
[group('deploy')]
verify-catalog origin="https://static.manaweb.app/catalog":
    cargo run --release -p manaweb-objects --bin manaweb-verify -- catalog {{ origin }}

# The manifest is the one place a version is written; CI holds the tag to it.
# The title is an argument because it was a default before, and a default
# nobody edits is how v0.6.0 and v0.7.0 came to be named after themselves.
[doc('bump the version, check, commit and tag it: `just release 0.8.0 "What it is for"`')]
[group('deploy')]
release version title body="":
    @test -z "$(git status --porcelain)" || { echo "tree is dirty"; exit 1; }
    awk '!done && /^version = / { sub(/=.*/, "= \"{{ version }}\""); done = 1 } 1' \
        Cargo.toml > Cargo.toml.next && mv Cargo.toml.next Cargo.toml
    cargo check --quiet --all-targets
    just check
    git add Cargo.toml Cargo.lock
    # Nothing to commit where the manifest already reads this, which is the
    # normal shape when the bump landed with the work.
    @git diff --cached --quiet || git commit -s -m "chore: {{ version }}"
    # `quote` rather than bare interpolation: a message goes through a shell on
    # its way to the tag, so a backtick or a `$` in one would run.
    @if [ -n {{ quote(body) }} ]; then \
        git tag -as v{{ version }} -m {{ quote(title) }} -m {{ quote(body) }}; \
    else \
        git tag -as v{{ version }} -m {{ quote(title) }}; \
    fi
