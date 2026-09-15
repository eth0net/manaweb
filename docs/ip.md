# Licensing and IP

What can be built and charged for, and under what license it ships.

- **AGPL-3.0-only** for the AppView — server, web UI, the running service.
- **MIT** for `lexicons/`. NSID schemas are shared vocabulary and the point is
  other people adopting them; copyleft on a schema file discourages exactly
  that. Same argument, weaker, for `crates/core`.
- Per-crate `license` fields in each `Cargo.toml` carry the split. GitHub only
  detects the root LICENSE, so the README explains it.
- Why AGPL rather than MIT/Apache like the rest of atproto: loosening a license
  later is trivial, tightening one forks projects (HashiCorp → OpenTofu, Redis
  → Valkey). Permissive would permanently foreclose a hosted option.
- Contributions take a DCO (`Signed-off-by`, via `git commit -s`), not a CLA.
  That does *not* preserve the right to relicense unilaterally, and the
  decision becomes irreversible at the first outside PR.

**The icon is not ours.** `web/public/icon.svg` is the spider web from Google's
Noto Emoji, taken via SVG Repo, which names the collection, googlefonts and the
Apache License. That flows into AGPL-3.0 one way and needs the attribution
kept, which the README carries.

## IP constraints

Two policies bind what can be built, whether or not money is involved.

**Mana symbols are Wizards' as much as the card art.** Scryfall's own footer
says so — "including card images and mana symbols" — and publishes an SVG per
symbol at `svgs.scryfall.io`, open CORS and cached for a year. Hotlinked rather
than redistributed, the same call as card images: we display Wizards' graphics
under the policy below and never ship a copy of them.

The disclaimer that obliges is in the app footer verbatim, with the detail
behind a Licenses modal. Scryfall's guidelines also ask that the source of card
data be identifiable, which the same footer does.

**WotC Fan Content Policy.** Selling Wizards-related content needs their
permission, and you "can't require payments, surveys, downloads, subscriptions,
or email registration to access your Fan Content". Donations and ad revenue are
explicitly permitted. The disclaimer must be carried verbatim wherever the
project is named: unofficial Fan Content permitted under the Fan Content
Policy, not approved/endorsed by Wizards, portions of the materials used are
property of Wizards of the Coast, ©Wizards of the Coast LLC. The policy doesn't
address software; an older Fan Site Policy is read by some as barring apps
outright, which sits awkwardly against the many MTG apps nobody has bothered.
Unresolved, not permission.

**Scryfall API terms**, enforced by blocking API access:

- No paywalling their data — no payment, subscription, survey or channel-follow
  in exchange for access. With accounts, users must still reach card data
  anonymously or free.
- No repackaging, republishing or proxying. Our software must add value.
- Image rules bind the UI: don't crop or cover the copyright or artist name,
  don't distort or recolor, no watermarks, and `art_crop` needs artist and
  copyright shown in the same interface.
- Don't imply Scryfall endorsement.

**EDHREC** is stricter again — personal noncommercial use, no automated
queries. See Phase 4.

The line all three draw: card data stays freely reachable, and anything gated
must be our own compute rather than access to someone else's data.

## References

- [WotC Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy)
- [Scryfall Terms of Service](https://scryfall.com/docs/terms)
- [EDHREC Terms of Use](https://edhrec.com/terms) — no automated queries,
  personal noncommercial use only
