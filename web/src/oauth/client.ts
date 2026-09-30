import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import { CLIENT_ID, RESOLVER, SCOPES } from "../config";

// A server can fetch neither a metadata document off a laptop nor one behind
// a name only this machine knows, so a loopback client is hard-coded for
// `http://localhost` and the rest of it read out of the id.
function loopbackId(): string {
  const host =
    location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
  const params = new URLSearchParams({
    redirect_uri: `http://${host}:${location.port}/`,
    // Part of the id, so editing it strands a code issued to the old one.
    scope: SCOPES.join(" "),
  });
  return `http://localhost?${params}`;
}

// Which client a dev build is, and why it is not always the loopback one,
// is `docs/configuration.md`.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function devId(): string {
  return LOOPBACK.has(location.hostname)
    ? loopbackId()
    : `${location.origin}/oauth/dev-client-metadata.json`;
}

let loading: Promise<BrowserOAuthClient> | undefined;

export function oauth(): Promise<BrowserOAuthClient> {
  loading ??= BrowserOAuthClient.load({
    clientId: import.meta.env.DEV ? devId() : CLIENT_ID,
    handleResolver: RESOLVER,
  });
  return loading;
}

type Init = Awaited<ReturnType<BrowserOAuthClient["init"]>>;

let started: Promise<Init> | undefined;

// init() takes the response out of the URL, so it runs once a page load.
export function restore(): Promise<Init> {
  started ??= oauth().then((client) => client.init());
  return started;
}
