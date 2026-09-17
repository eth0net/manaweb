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
check: rust deny spell prose lexicons web

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

# validate the lexicons against atproto's own implementation (needs bun)
[group('checks')]
lexicons: deps
    cd tools/lexicon-check && bun run check
    cd tools/lex-gen && bun run gen --check

# rewrite the record types the client reads records with (needs bun)
[group('dev')]
lexicon-types: deps
    cd tools/lex-gen && bun run gen

# lint, typecheck, test and build the client (needs bun)
[group('checks')]
web: deps
    cd web && bun run check

# Both default to loopback; pass 0.0.0.0 to either to reach it from a phone.
[doc('export the catalog and serve it for local development')]
[group('dev')]
serve bind="127.0.0.1:8080":
    MANAWEB_DATABASE={{ db }} MANAWEB_BIND={{ bind }} cargo run -p manaweb-appview

[doc("the client's dev server, fetching the catalog from `just serve`")]
[group('dev')]
client host="127.0.0.1": deps
    cd web && bun run dev --host {{ host }}

# sync the card cache from Scryfall (~78MB), or from a file already on disk
[group('dev')]
sync file="":
    cargo run --release -p manaweb-core --example sync -- {{ db }} {{ file }}

# build the client artifact and report its size, optionally writing the files
[group('dev')]
catalog out="":
    cargo run --release -p manaweb-core --example catalog -- {{ db }} {{ out }}

# Needs a deployment rather than a checkout, which is why it is not in `check`.
[doc('fetch a deployed client metadata document and hold it to its own URL')]
[group('deploy')]
[script('python3')]
verify-oauth url="https://manaweb.app/oauth/client-metadata.json":
    import json, sys, urllib.error, urllib.request

    url = "{{ url }}"
    try:
        response = urllib.request.urlopen(url)
    except urllib.error.HTTPError as error:
        response = error  # an HTTPError is the response, and 404 is a finding
    except urllib.error.URLError as error:
        sys.exit(f"  FAIL  {url} unreachable: {error.reason}")

    with response:
        status = response.status
        kind = response.headers.get_content_type()
        body = response.read()

    # A single-page fallback answers 200 with HTML for a path it doesn't have,
    # so "did it deploy" and "is it JSON" are one question.
    problems = []
    if status != 200:
        problems.append(f"status {status}, must be exactly 200")
    if kind != "application/json":
        problems.append(f"content-type {kind}, must be application/json")

    try:
        client_id = json.loads(body).get("client_id")
    except ValueError as error:
        problems.append(f"not JSON: {error}")
    else:
        if client_id != url:
            problems.append(f"client_id is {client_id}, must equal the URL fetched")

    for problem in problems:
        print(f"  FAIL  {problem}")
    print("\nFAILED" if problems else "  ok    served as its own client_id")
    sys.exit(1 if problems else 0)

# Content-addressed files are immutable; the manifest is the only thing a
# client re-reads, and it goes last so it never names an object not yet there.
[doc('upload the catalog the manifest names to R2 (needs wrangler, and an authenticated Cloudflare)')]
[group('deploy')]
[script('python3')]
upload dir="catalog" bucket="manaweb-static":
    import json, pathlib, subprocess, sys

    IMMUTABLE = "public, max-age=31536000, immutable"
    directory = pathlib.Path("{{ dir }}")
    wrangler = pathlib.Path("node_modules/.bin/wrangler").resolve()
    if not wrangler.exists():
        sys.exit("  FAIL  no wrangler: run `bun install`")

    manifest = directory / "manifest.json"
    try:
        named = json.loads(manifest.read_bytes())
    except OSError as error:
        sys.exit(f"  FAIL  no manifest: {error}. Run `just serve` to export one")

    pair = [named["cards"]["name"], named["prints"]["name"]]
    for name in pair + ["manifest.json"]:
        path = directory / name
        if not path.is_file():
            sys.exit(f"  FAIL  {manifest} names {name}, which is not in {directory}")

    def put(name, cache):
        path = directory / name
        subprocess.run(
            [
                str(wrangler), "r2", "object", "put", f"{{ bucket }}/{name}",
                "--file", str(path), "--remote",
                "--content-type", "application/json", "--cache-control", cache,
            ],
            check=True,
        )
        print(f"  ok    {name}  {path.stat().st_size // 1024} KiB  {cache}")

    for name in pair:
        put(name, IMMUTABLE)
    put("manifest.json", "no-cache")
    print(f"\nversion {named['version']}")

# Needs the bucket's custom domain, whose CORS and cache rules are set in
# Cloudflare rather than on an object, so a checkout cannot answer for them.
[doc('fetch a deployed catalog and hold it to the headers a client needs')]
[group('deploy')]
[script('python3')]
verify-catalog origin="https://static.manaweb.app":
    import json, sys, urllib.error, urllib.request

    base = "{{ origin }}".rstrip("/")
    problems = []

    def fetch(url, method="GET"):
        # An Origin makes the reply carry the CORS headers a browser would get.
        request = urllib.request.Request(
            url, method=method, headers={"Origin": "https://manaweb.app"}
        )
        try:
            return urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            return error
        except urllib.error.URLError as error:
            sys.exit(f"  FAIL  {url} unreachable: {error.reason}")

    with fetch(f"{base}/manifest.json") as response:
        status, headers = response.status, response.headers
        body = response.read()

    if status != 200:
        problems.append(f"manifest.json: status {status}, must be 200")
    if headers.get_content_type() != "application/json":
        problems.append(f"manifest.json: content-type {headers.get_content_type()}")
    if headers.get("access-control-allow-origin") != "*":
        problems.append(
            "manifest.json: no CORS, so every catalog fetch fails in a browser"
        )
    if "no-cache" not in (headers.get("cache-control") or ""):
        problems.append(
            f"manifest.json: cache-control {headers.get('cache-control')!r}, "
            "must be no-cache or a stale one pins the client to an old pair"
        )

    named = {}
    try:
        named = json.loads(body)
    except ValueError as error:
        problems.append(f"manifest.json: not JSON: {error}")

    for part in ("cards", "prints"):
        name = named.get(part, {}).get("name")
        if not name:
            continue
        with fetch(f"{base}/{name}", method="HEAD") as response:
            if response.status != 200:
                problems.append(f"{name}: status {response.status}, named but not served")
            elif "immutable" not in (response.headers.get("cache-control") or ""):
                problems.append(f"{name}: cache-control is not immutable")
            else:
                print(f"  ok    {name}  cached {response.headers.get('cf-cache-status')}")

    for problem in problems:
        print(f"  FAIL  {problem}")
    print("\nFAILED" if problems else f"  ok    {named.get('version')} served")
    sys.exit(1 if problems else 0)
