// Holds a wasm build of the scanner to what the native one answers.
//
//     bun run check
//
// The crate exists to run in a browser, and CI tests it on three targets that
// are not that one. A hash that differed there would retrieve nothing from the
// published index and report no error doing it, so the two builds are compared
// rather than each pinned to a copy of the numbers.

import { dirname, join } from "node:path";
import { Engine } from "../../web/src/scan/engine";

const ROOT = dirname(dirname(import.meta.dir));
const TARGET = "wasm32-unknown-unknown";
const MODULE = join(ROOT, "target", TARGET, "release", "manaweb_scanner.wasm");

// What ships, and what a plain build does. Both, because the vector extension
// is the one thing here that changes the arithmetic the compiler emits.
const BUILDS = [
  { name: "plain", flags: "" },
  { name: "simd128", flags: "-C target-feature=+simd128" },
];

// `crates/scanner`'s own probe, restated rather than shipped — see the
// engine's golden vectors. Color, so the conversion is on the way through.
const PROBE = { width: 64, height: 48 };
const CHANNELS: [number, number][] = [
  [7, 11],
  [13, 5],
  [3, 17],
];

function probe(): Uint8Array {
  const { width, height } = PROBE;
  const out = new Uint8Array(width * height * CHANNELS.length);
  for (let at = 0; at < width * height; at++) {
    CHANNELS.forEach(([across, down], which) => {
      out[at * CHANNELS.length + which] =
        ((at % width) * across + Math.floor(at / width) * down) % 251;
    });
  }
  return out;
}

// The same pixels with each row padded, which is what a camera hands over.
function padded(luma: Uint8Array, stride: number): Uint8Array {
  const { width, height } = PROBE;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    out.set(luma.subarray(y * width, (y + 1) * width), y * stride);
  }
  return out;
}

let failed = false;
const fail = (message: string) => {
  console.log(`  FAIL  ${message}`);
  failed = true;
};
const ok = (message: string) => console.log(`  ok    ${message}`);

async function run(cmd: string[], env: Record<string, string> = {}) {
  const held = Bun.spawn(cmd, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(held.stdout).text(),
    new Response(held.stderr).text(),
  ]);
  if ((await held.exited) !== 0) {
    throw new Error(`${cmd.join(" ")}\n${err}`);
  }
  return out;
}

console.log("native:");
const stated = (
  await run([
    "cargo",
    "run",
    "-q",
    "-p",
    "manaweb-scanner",
    "--example",
    "probe",
  ])
)
  .trim()
  .split("\n");
const want = stated.slice(0, -1);
const fingerprint = stated.at(-1) as string;
ok(`${want.length} hashes and fingerprint ${fingerprint}`);

const hex = (hash: bigint) => hash.toString(16).padStart(16, "0");
const color = probe();

for (const build of BUILDS) {
  console.log(`\n${build.name}:`);
  // Passed rather than left in a config file: CI sets RUSTFLAGS itself, and an
  // environment one silently replaces what the config says.
  await run(
    [
      "cargo",
      "rustc",
      "-q",
      "-p",
      "manaweb-scanner",
      "--target",
      TARGET,
      "--release",
      "--crate-type",
      "cdylib",
    ],
    { RUSTFLAGS: build.flags },
  );

  const bytes = await Bun.file(MODULE).bytes();
  const engine = await Engine.load(bytes);

  if (engine.hashes !== want.length) {
    fail(`${engine.hashes} hashes against ${want.length}`);
    continue;
  }

  if (hex(engine.fingerprint) !== fingerprint) {
    fail(`fingerprint ${hex(engine.fingerprint)} against ${fingerprint}`);
  } else {
    ok(`fingerprint ${fingerprint}`);
  }

  const levels = engine.luma(color, CHANNELS.length);
  const got = engine.entry(levels, PROBE.width, PROBE.height).map(hex);
  if (got.join() !== want.join()) {
    fail(`entry ${got.join()} against ${want.join()}`);
  } else {
    ok(`entry ${got.join(" ")}`);
  }

  const stride = PROBE.width + 13;
  const same = engine
    .entry(padded(levels, stride), PROBE.width, PROBE.height, stride)
    .map(hex);
  if (same.join() !== want.join()) {
    fail(`padded rows gave ${same.join()}`);
  } else {
    ok(`${stride} bytes a row reads the same ${PROBE.width}`);
  }
}

console.log(failed ? "\nsomething disagrees" : "\nall green");
process.exit(failed ? 1 : 0);
