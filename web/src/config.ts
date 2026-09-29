// Two origins because there are two cadences: `docs/architecture.md`. In
// development it is one, the dev server passing `/catalog` through to the
// binary, so that reaching the app over HTTPS reaches the catalog too.
// Absolute either way: what reads this resolves a file name against it, and
// a base has to be a whole URL to resolve anything against.
export const CATALOG = import.meta.env.DEV
  ? `${location.origin}/catalog`
  : "https://static.manaweb.app/catalog";

// A browser has no DNS, so resolving a handle needs a service that has. Why
// a public one, and which ones will not do, is `docs/configuration.md`.
// `MANAWEB_WEB_RESOLVER` overrides it at build time.
export const RESOLVER =
  import.meta.env.MANAWEB_WEB_RESOLVER || "https://bsky.social";

// A `repo:` scope names one exact collection, so this list is the enumeration.
// Only what the client writes today, for the reason in `docs/atproto.md`.
export const COLLECTIONS = [
  "app.manaweb.card",
  "app.manaweb.container",
  "app.manaweb.import",
  "app.manaweb.profile",
] as const;

// Held equal to the committed document by a test: PAR refuses what it omits.
export const SCOPES = [
  "atproto",
  ...COLLECTIONS.map((collection) => `repo:${collection}`),
  // Uploading is its own resource: `repo:` covers the record naming a blob,
  // never the blob itself, and this one cannot sit in a permission set.
  "blob:image/*",
];

export const CLIENT_ID = "https://manaweb.app/oauth/client-metadata.json";
