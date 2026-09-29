// The capture route is a development one, and that promise is only worth
// what it can be shown. Read the build back for it rather than trusting the
// branch to have been dropped.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE } from "../src/scan/capture.ts";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

function* under(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* under(path);
    else yield path;
  }
}

const carrying = [...under(DIST)].filter((path) =>
  readFileSync(path, "latin1").includes(CAPTURE),
);

if (carrying.length > 0) {
  console.error(`The build carries ${CAPTURE}:`);
  for (const path of carrying) console.error(`  ${path}`);
  process.exit(1);
}
