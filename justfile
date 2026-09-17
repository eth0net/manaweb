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

# Every at-uri in the fixtures names the primary author, and is rewritten to
# whichever account this writes to. `goat account login` first.
[doc('seed a dev account with the fixture records (needs goat)')]
[group('dev')]
[script('python3')]
seed handle dir="fixtures/records":
    import pathlib, shutil, subprocess, sys

    AUTHOR = "did:plc:rk2rhs4yvucutbrd2aoi5gci"
    CONTAINER = "app.manaweb.container"
    directory = pathlib.Path("{{ dir }}")
    if not shutil.which("goat"):
        sys.exit("  FAIL  no goat: go install github.com/bluesky-social/goat@latest")

    def goat(*args, **rest):
        return subprocess.run(
            ["goat", *args], capture_output=True, text=True, **rest
        )

    found = goat("resolve", "--did", "{{ handle }}")
    if found.returncode != 0:
        sys.exit(f"  FAIL  {{ handle }}: {found.stderr.strip()}")
    did = found.stdout.strip()

    # goat writes to whoever it is logged in as, and the handle only decides
    # whose DID the records name. Mismatched, that lands one account's records
    # in another's repo pointing at the first, and nothing reports it.
    signed = goat("account", "check-auth")
    if signed.returncode != 0:
        sys.exit(f"  FAIL  {signed.stderr.strip()}. Run `goat account login`")
    session = next(
        (
            line.removeprefix("DID:").strip()
            for line in signed.stdout.splitlines()
            if line.startswith("DID:")
        ),
        "",
    )
    if session != did:
        sys.exit(f"  FAIL  logged in as {session}, not {{ handle }} ({did})")

    # Containers first, so anything reading as this lands sees a card's place
    # before the card naming it.
    files = sorted(
        directory.glob("*/*.json"),
        key=lambda one: (one.parent.name != CONTAINER, one.name),
    )
    if not files:
        sys.exit(f"  FAIL  no records under {directory}")

    for path in files:
        collection, rkey = path.parent.name, path.stem
        # A create refuses a key already there, and these keys are fixed.
        goat("record", "delete", "-c", collection, "-r", rkey)
        written = goat(
            "record", "create", "-r", rkey, "-",
            input=path.read_text().replace(AUTHOR, did),
        )
        if written.returncode != 0:
            sys.exit(f"  FAIL  {collection}/{rkey}: {written.stderr.strip()}")
        uri = written.stdout.split()
        print(f"  ok    {uri[0] if uri else f'{collection}/{rkey}'}")

    print(f"\n{len(files)} records on {did}")

# Needs a deployment rather than a checkout, which is why it is not in `check`.
[doc('fetch a deployed client metadata document and hold it to its own URL')]
[group('deploy')]
[script('python3')]
verify-oauth url="https://manaweb.app/oauth/client-metadata.json":
    import json, sys, urllib.error, urllib.request

    url = "{{ url }}"
    # Named for the same reason `verify-catalog` names itself.
    request = urllib.request.Request(
        url, headers={"User-Agent": "manaweb-verify (+https://manaweb.app)"}
    )
    try:
        response = urllib.request.urlopen(request)
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
[script('python3')]
verify-catalog origin="https://static.manaweb.app/catalog":
    import json, sys, urllib.error, urllib.request

    base = "{{ origin }}".rstrip("/")
    problems = []

    def fetch(url, method="GET"):
        # An Origin makes the reply carry the CORS headers a browser would get.
        # Cloudflare's browser integrity check answers urllib's own agent with
        # a 403 and error code 1010, so this says who it is instead.
        request = urllib.request.Request(
            url,
            method=method,
            headers={
                "Origin": "https://manaweb.app",
                "User-Agent": "manaweb-verify (+https://manaweb.app)",
            },
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
