# Configuration

Every variable the binary and the tools read, with its default. Nothing reads
a `.env` file: `.env.example` names the variables, and how they reach the
process — systemd, a container's environment, a shell — is yours to decide.

## The server

`manaweb-appview`, the `manaweb` binary. The first four have defaults, so it
starts with none of them set and syncs into `manaweb.db` in the working
directory.

| Variable | Default | What it is |
|---|---|---|
| `MANAWEB_DATABASE` | `manaweb.db` | The SQLite file holding the card cache. |
| `MANAWEB_CATALOG` | `catalog` | Where the exported catalog is written, and what is served for local development. |
| `MANAWEB_BIND` | `127.0.0.1:8080` | Address to listen on. `0.0.0.0:8080` to reach it from another device. |
| `MANAWEB_SYNC` | `1` | `0` or `false` starts without the weekly Scryfall sync. |
| `MANAWEB_HASHES` | unset | The store `manaweb-artwork` wrote. Unset publishes a catalog with no artwork index, and so no scanner. |
| `MANAWEB_HASHES_CAP` | `600` | Artworks one refresh adds to that store. `0` leaves it alone. |

The client's dev server takes `MANAWEB_DEV_HOSTS` — a hostname, several
comma-separated, or `any` — for reaching it through a tunnel, which answers
on a name it has never heard of and refuses by default. That refusal is what
stops a page on another site pointing a name it owns at this machine and
then talking to the server as though it were the same origin, so `any` is
worth spending only on a tunnel whose name is awkward to predict, and naming
the host is better. What either can reach is held to the app and its
dependencies rather than to the whole checkout, because the lockfile at the
root would otherwise make the database and the notes beside it fair game.
That is how a phone gets at it: a camera needs a secure context, and the LAN
address the dev server answers on is not one, so plain HTTP reaches
everything but the scanner. The catalog passes through the same server
rather than being fetched from the binary directly, so one tunnel carries
both.

**A deployment has no scanner until a store is copied to it.** The builder
runs where the artwork can be pulled, which is a laptop rather than the box,
and three things turn it on: `manaweb-artwork pull` then `hash` to write a
store, that file onto the host, and `MANAWEB_HASHES` naming it. Nothing in
the image does any of it, and a server without one publishes a catalog that
is correct and has no index, so the only sign is `no artwork index` in the
log beside `artwork=0` and a tab saying there is nothing to scan against.

A `MANAWEB_HASHES` naming nothing readable stops the process rather than
publishing a catalog without an index: the scanner would be missing and only a
log line would say why. It is read at each export, so a newer store left in
place is picked up by the weekly sync.

Both paths want a volume of their own in a container: the cache is 96MB and
several minutes of Scryfall's bandwidth to rebuild, and the catalog is what
the upload reads back to decide what has moved. The store is a third, and
read-only: nothing on the server writes it, and building one wants the
artwork the builder pulls rather than anything a deployment holds. The image
leaves `MANAWEB_HASHES` unset for that reason — a default pointing into the
volume would stop every container that has no store yet.

**A container that will not start may be holding a stranded cache.** sqlx
checksums every migration it applies and refuses a database whose record
disagrees, so a migration edited after it shipped — `0003` was, in a commit
that only retargeted a comment — stops the process before it binds, with
`applying migrations failed: migration 3 was previously applied but has been
modified` and nothing else. A test holds the four checksums now, so it cannot
happen again; a volume it already happened to is unstuck either by deleting
the database, the cache being derived from Scryfall and disposable, or by
writing the file's own sha384 over the recorded one:

```sql
UPDATE _sqlx_migrations SET checksum = x'<sha384 of the file>' WHERE version = <n>;
```

Deleting it is the one to reach for. It costs a download that happens weekly
anyway, and it leaves a cache nobody has edited by hand.

The catalog directory does not hold every export ever made. Each one keeps
what the manifest before it named, and keeps anything written in the last six
hours whatever the manifests say, so nothing is taken from a client part way
through fetching it — then removes the rest. A weekly refresh settles at
roughly 27MB rather than adding 14MB a week forever, and a run of exports in
one afternoon settles a few hours after the last of them. Only
content-addressed names are touched, so anything else parked there
survives.

## The bucket

Read by `manaweb-objects`, so by the server's own upload and by
`manaweb-upload`. Unset means no upload is attempted at all, which is the
right state for a checkout with no credentials.

| Variable | Default | What it is |
|---|---|---|
| `MANAWEB_S3_ENDPOINT` | unset | The bucket's own endpoint, not the domain it is served from. For R2, the account's S3 endpoint. |
| `MANAWEB_S3_BUCKET` | unset | Bucket name. |
| `MANAWEB_S3_KEY_ID` | unset | Access key id. |
| `MANAWEB_S3_SECRET` | unset | Secret access key. For an R2 API token, the SHA-256 of the token value. |
| `MANAWEB_S3_REGION` | `auto` | What R2 wants, and then ignores. |

The endpoint is the one that decides: with it set, the other three are
required and a missing one is an error rather than a silent skip.

## The client

Built into the bundle rather than read at run time, so changing one means
building again. Vite reads `web/.env` for these itself — the one file here
that is read, and not the same file as the server's.

| Variable | Default | What it is |
|---|---|---|
| `MANAWEB_WEB_RESOLVER` | `https://bsky.social` | Where a handle is turned into a DID. |

A browser has no DNS, so somebody with one has to answer. The default is
public and is not ours: it stays up when our box does not, and nobody signing
in learns where we keep anything. What it has to be is a server that resolves
a handle it has never hosted — a PDS running the reference implementation
does, an AppView answering out of its own index does not, and a self-hosted
handle that has never posted anywhere is exactly the case that tells them
apart.

The prefix says which half of Manaweb a variable configures, and it is
longer than `MANAWEB_` on purpose: that one names the server's variables, the
bucket's secret is among them, and only what matches the prefix can be read
here at all.

**Signing in from a phone needs a client the PDS can fetch.** An OAuth
server cannot read a metadata document off a laptop, so for `localhost` the
client is the hard-coded loopback one and everything about it is read out of
the id. That only answers for a loopback address: reached over a tunnel the
page has a public name, the loopback client is refused, and the dev server
serves a document of its own at `/oauth/dev-client-metadata.json` naming that
origin. Its scope is read from the committed document rather than written
twice, a scope missing there being refused at PAR rather than at sign-in.
Plain HTTP over the LAN gets neither — the name is not resolvable from
outside and the id has to be `https` — which is the second reason the tunnel
is how a phone reaches this.

## The builder

`manaweb-artwork` builds and measures the scanner index. What it works on is
an argument rather than a variable — the cache, a directory, how many to stop
at — and the one variable it reads only changes what it prints.

| Variable | Default | What it is |
|---|---|---|
| `MANAWEB_SHOTS` | unset | Set to anything, and `photos` reports every photograph instead of only the ones it got wrong. |

The full listing is what the bands in [`scanner.md`](scanner.md) were read
off, so it is the one to run when that table is being extended rather than
consulted.

## Secrets

The key pair is the only secret here, and it belongs in whatever the host
already uses — a password manager, a systemd credential, a container secret.
Not in the repo: `.env` is ignored and `.env.example` carries no values.

All four have to arrive as values. Where they are kept as references for
something to resolve, handing that file to the process unresolved exports the
reference itself, and the failure is a URI parse error from inside the S3
client rather than anything naming the cause.

Scope the R2 token to the one bucket, and give it object read as well as
write — the upload HEADs a name before sending it. See
[`architecture.md`](architecture.md) for why.
