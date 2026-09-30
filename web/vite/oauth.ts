// A client the PDS can look up, for a dev server reached over a tunnel.
//
// `apply: "serve"` is the whole of why this is safe: there is no build half,
// so nothing that deploys can carry it. What deploys is the committed
// document under `web/public`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Served here rather than at the committed document's own path, which Vite
// already serves out of `public`.
export const METADATA = "/oauth/dev-client-metadata.json";

// What the deployed client asks for, read off the document it deploys with
// rather than said twice: a scope missing here is refused at PAR, and the
// two drifting apart would only show at sign-in.
function scope(): string {
  const at = new URL("../public/oauth/client-metadata.json", import.meta.url);
  const held: unknown = JSON.parse(readFileSync(fileURLToPath(at), "utf8"));
  const asked =
    typeof held === "object" && held !== null
      ? (held as { scope?: unknown }).scope
      : undefined;
  if (typeof asked !== "string") {
    throw new Error("the committed client metadata names no scope");
  }
  return asked;
}

function document(origin: string, scope: string): string {
  return JSON.stringify(
    {
      client_id: `${origin}${METADATA}`,
      client_name: "Manaweb (development)",
      client_uri: origin,
      redirect_uris: [`${origin}/oauth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
      token_endpoint_auth_method: "none",
      application_type: "web",
      dpop_bound_access_tokens: true,
    },
    null,
    2,
  );
}

export function client(): Plugin {
  return {
    name: "manaweb-oauth-client",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(METADATA, (request, response) => {
        // The PDS fetches this, not the browser, so the origin comes off the
        // request. A tunnel terminates TLS, so the scheme does too.
        const host = request.headers.host;
        if (!host) {
          response.statusCode = 400;
          response.end("no host");
          return;
        }
        const proto = request.headers["x-forwarded-proto"];
        const scheme =
          typeof proto === "string" ? proto.split(",")[0] : "http";
        response.setHeader("content-type", "application/json");
        response.end(document(`${scheme}://${host}`, scope()));
      });
    },
  };
}
