// The capture route and the timing readout are development ones, and that
// promise is only worth what it can be shown. Read the build back for each
// rather than trusting the branch to have been dropped.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MEASURING } from "../src/scan/bench.ts";
import { CAPTURE } from "../src/scan/capture.ts";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

// One string each, distinctive enough that nothing else emits it.
const MARKS = [CAPTURE, MEASURING];

function* under(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* under(path);
    else yield path;
  }
}

const carrying = [...under(DIST)].flatMap((path) => {
  const held = readFileSync(path, "latin1");
  return MARKS.filter((mark) => held.includes(mark)).map((mark) => ({
    path,
    mark,
  }));
});

if (carrying.length > 0) {
  for (const { path, mark } of carrying) {
    console.error(`The build carries ${JSON.stringify(mark)}: ${path}`);
  }
  process.exit(1);
}
