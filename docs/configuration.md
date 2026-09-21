# Configuration

Every variable the binary and the tools read, with its default. Nothing reads
a `.env` file: `.env.example` names the variables, and how they reach the
process — systemd, a container's environment, a shell — is yours to decide.

## The server

`manaweb-appview`, the `manaweb` binary. All four have defaults, so it starts
with none of them set and syncs into `manaweb.db` in the working directory.

| Variable | Default | What it is |
|---|---|---|
| `MANAWEB_DATABASE` | `manaweb.db` | The SQLite file holding the card cache. |
| `MANAWEB_CATALOG` | `catalog` | Where the exported catalog is written, and what is served for local development. |
| `MANAWEB_BIND` | `127.0.0.1:8080` | Address to listen on. `0.0.0.0:8080` to reach it from another device. |
| `MANAWEB_SYNC` | `1` | `0` or `false` starts without the weekly Scryfall sync. |

Both paths want a volume of their own in a container: the cache is 80MB and
several minutes of Scryfall's bandwidth to rebuild, and the catalog is what
the upload reads back to decide what has moved.

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
