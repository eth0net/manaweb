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

export function headers(nonce: string, from = "public/_headers"): Plugin {
  const wanted = parse(readFileSync(from, "utf8")).map(
    ([name, value]): Header => [
      name,
      name.toLowerCase() === "content-security-policy"
        ? nonced(value, nonce)
        : value,
    ],
  );

  return {
    name: "manaweb-headers",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        for (const [name, value] of wanted) response.setHeader(name, value);
        next();
      });
    },
  };
}
