// What build a page is running, because a device holding an old bundle and
// a fix that did not work report the same thing otherwise.
//
// In development that is the newest source file, read when the module is
// served: reload and it tells the truth. Between reloads it is whatever was
// true at the last one, so it reads old on a page hot updates have kept
// current — conservative in the direction that costs a reload rather than an
// afternoon.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const ID = "virtual:built";

// Vite's own marker for a module no file backs.
const HELD = `\0${ID}`;

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function* under(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* under(path);
    else yield path;
  }
}

function newest(): number {
  let at = 0;
  for (const path of under(SRC)) at = Math.max(at, statSync(path).mtimeMs);
  return at;
}

// `--dirty` matters more than the hash: a stamp naming a commit the files no
// longer match is worse than one admitting it does not know.
function revision(): string {
  try {
    return execFileSync(
      "git",
      ["describe", "--always", "--dirty", "--abbrev=8"],
      // Its stderr is inherited by default, so a checkout without `.git`
      // prints git's complaint before the fallback answers for it.
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "unknown";
  }
}

export function built(): Plugin {
  let serving = false;

  return {
    name: "manaweb-built",
    configResolved(config) {
      serving = config.command === "serve";
    },
    resolveId: (id) => (id === ID ? HELD : null),
    // Nothing on disk backs it, so nothing would otherwise retire the
    // transform Vite keeps, and it would answer with the time the server
    // started however often it was asked again.
    handleHotUpdate({ server }) {
      const held = server.moduleGraph.getModuleById(HELD);
      if (held) server.moduleGraph.invalidateModule(held);
    },
    load(id) {
      if (id !== HELD) return null;
      const at = serving ? newest() : Date.now();
      return [
        `export const at = ${JSON.stringify(new Date(at).toISOString())};`,
        `export const rev = ${JSON.stringify(revision())};`,
      ].join("\n");
    },
  };
}
