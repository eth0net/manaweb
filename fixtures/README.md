# Fixtures

Test accounts on `pds.e0n.sh`, which serves handles under both `.mnwb.me` and
`.pds.e0n.sh`, and the records that seed them. `goat` writes those, so there is
no CLI of ours to build — it now lives at `github.com/bluesky-social/goat`
rather than under `indigo/cmd`, which is where `go install` still sends people.

Passwords belong in 1Password and never in this file. DIDs are public
identifiers, so each one gets recorded below once its account exists.

## The cast

`mnwb.me` is the authoring domain, so the personas live there, each named for
a path it exercises rather than for itself.

| handle | did | role it plays |
|---|---|---|
| `liliana.mnwb.me` | `did:plc:rk2rhs4yvucutbrd2aoi5gci` | primary author: a real collection and published decks |
| `jace.mnwb.me` | | forks everything, so `forkedFrom` is always exercised |
| `nissa.mnwb.me` | `did:plc:exdeooh3bfnsmzi36okzo6zw` | hoards. Thousands of entries, for the import ceiling |
| `squee.mnwb.me` | | writes and deletes constantly, and comes back regardless |
| `norin.mnwb.me` | | deactivates and reactivates at any provocation |
| `teferi.mnwb.me` | | writes, then goes quiet past the replay window |
| `bob.mnwb.me` | | signed in holding nothing at all |

The first account accumulates data whose DID has to survive. The personas
exist to be deleted, which is why only one of them is worth naming carefully.

## Seeding

    goat account login -u liliana.mnwb.me -p <app password>
    just seed liliana.mnwb.me

`records/<collection>/<rkey>.json` is the whole layout: the directory names
the collection and the filename is the record key, so a record needs nothing
of its own to say where it goes. Every key is a fixed TID, which is what makes
a second seed replace the first rather than doubling it, and the lexicon check
holds the files to their schemas so a broken one is found before a seed is.

An at-uri carries the account, and a container is referenced by one, so the
files write the DID of the primary author below and `just seed` rewrites it to
whichever account it is given. Seeding that account therefore rewrites nothing.

## What a handle may be

Three to eighteen characters before the service domain, no dot inside it, and
not one of the 1,030 reserved names the PDS ships in
`packages/pds/src/handle/reserved.ts`. `dev`, `test` and `sandbox` are all on
that list, which is why the personas are named after people.

`com.atproto.admin.updateAccountHandle` is the only endpoint waiving the
reserved check, so a reserved name is still reachable: create the account under
a free one and move it afterwards.

A handle outside the service domains — `elliot.e0n.sh`, say — cannot be set at
creation, because the PDS verifies that the handle resolves to the account's
DID and no DID exists yet. Publish `_atproto.<handle>` as a TXT record holding
`did=…` first, then `goat account update-handle`.

## Creating one

```
docker exec pds goat pds admin account create \
  --handle liliana.mnwb.me --email … --password …
```

The invite code generates itself, so `PDS_INVITE_REQUIRED` costs nothing here.
`goat pds admin account delete <did>` clears an account off the PDS, but its
PLC entry stays public permanently — a DID can be tombstoned, never withdrawn.
So keep the cast small and reuse it.

## Resetting

`pds.e0n.sh` announces itself to `https://bsky.network`, so an account here is
an account on the public network: the relay carries whole repos, which means
`app.manaweb.*` records ride the firehose alongside anything Bluesky reads.

**Delete the accounts, then wipe the disk — never the other way round.**
`goat pds admin account delete <did>` drops the repo and sequences an event
saying so, which is what lets relays and AppViews let go of it. Wiping
`pds_data` first skips that: the directory still points every DID at this
server, which no longer holds their repos, so those reads start failing against
a relay that believes otherwise. Reusing a DID afterwards is worse than
orphaning it, because a repo whose revision restarts below what the relay
already holds reads as a fork.

Recreating an account is therefore a new DID and a new identity, not the same
one back. `docs/atproto.md` covers what survives a reset and what a rotation
key is for.
