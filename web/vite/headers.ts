// Pages reads `_headers` and nothing else does, so the dev server would be
// the one place the policy is not enforced.

import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export type Header = [name: string, value: string];

// A policy holds `data:` and `https:`, so the name ends at the first colon
// and everything after it is the value.
export function parse(text: string, path = "/*"): Header[] {
  const rules = text.split(/^(?=\S)/m);
  const mine = rules.find((rule) => rule.split("\n")[0]?.trim() === path);

  return (mine ?? "")
    .split("\n")
    .filter((line) => /^\s+[A-Za-z][\w-]*: /.test(line))
    .map((line) => {
      const at = line.indexOf(": ");
      return [line.slice(0, at).trim(), line.slice(at + 2).trim()];
    });
}

// The dev server's own scripts are inline — React Refresh's preamble above
// everything else — so they are let through by nonce rather than by opening
// `script-src` to anything inline.
export function nonced(value: string, nonce: string): string {
  return value.replace(/script-src ([^;]*)/, `script-src $1 'nonce-${nonce}'`);
}

// What `just serve` binds by default, and what the client asks for the catalog
// on while `import.meta.env.DEV`.
const CATALOG = 8080;

// The catalog is a second origin by design, and in development it is the
// binary's own port over plain http — which `https:` does not reach. Taken
// from the request so a phone on the LAN names the laptop, not itself.
export function reachable(value: string, host: string): string {
  const name = host.replace(/:\d+$/, "");
  if (!name) return value;

  return value.replace(
    /connect-src ([^;]*)/,
    `connect-src $1 http://${name}:${CATALOG}`,
  );
}

export function headers(nonce: string, from = "public/_headers"): Plugin {
  const wanted = parse(readFileSync(from, "utf8"));

  return {
    name: "manaweb-headers",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        for (const [name, value] of wanted) {
          response.setHeader(
            name,
            name.toLowerCase() === "content-security-policy"
              ? reachable(nonced(value, nonce), request.headers.host ?? "")
              : value,
          );
        }
        next();
      });
    },
  };
}
