// Two origins because there are two cadences: `docs/architecture.md`.
// Dev takes the page's own host, so a phone on the LAN reaches the laptop.
export const CATALOG = import.meta.env.DEV
  ? `http://${location.hostname}:8080`
  : "https://static.manaweb.app";

// A browser has no DNS, so resolving a handle needs a service that has.
export const RESOLVER = "https://pds.e0n.sh";

// A `repo:` scope names one exact collection, so this list is the enumeration.
// Only what the client writes today, for the reason in `docs/atproto.md`.
export const COLLECTIONS = [
  "app.manaweb.card",
  "app.manaweb.container",
] as const;

// Held equal to the committed document by a test: PAR refuses what it omits.
export const SCOPES = [
  "atproto",
  ...COLLECTIONS.map((collection) => `repo:${collection}`),
];

export const CLIENT_ID = "https://manaweb.app/oauth/client-metadata.json";
