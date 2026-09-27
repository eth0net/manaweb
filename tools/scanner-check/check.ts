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

// And the table, restated the same way.
const TABLE = { width: 400, height: 300 };
const DRAWN = { x: 100, y: 60, width: 126, height: 176 };
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

function table(): Uint8Array {
  const out = new Uint8Array(TABLE.width * TABLE.height).fill(30);
  for (let down = 0; down < DRAWN.height; down++) {
    for (let across = 0; across < DRAWN.width; across++) {
      const at = (DRAWN.y + down) * TABLE.width + DRAWN.x + across;
      out[at] = 140 + ((across * 7 + down * 11) % 100);
    }
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
// A line a call, named, because floats and counts go out beside hashes.
const stated = new Map(
  (
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
    .split("\n")
    .map((line) => {
      const [name, ...rest] = line.split(" ");
      return [name as string, rest] as const;
    }),
);

const said = (name: string): string[] => {
  const held = stated.get(name);
  if (!held) throw new Error(`the probe stated no ${name}`);
  return held;
};

const want = said("entry");
const fingerprint = said("fingerprint")[0] as string;
ok(`${want.length} hashes and fingerprint ${fingerprint}`);
ok(`a card at ${said("detect").join(" ")}`);

const hex = (hash: bigint) => hash.toString(16).padStart(16, "0");

// Floats as the probe prints them.
const bits = (held: number[]) =>
  Array.from(new Uint32Array(Float32Array.from(held).buffer), (word) =>
    word.toString(16).padStart(8, "0"),
  );
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

  if (engine.words !== Number(said("words")[0])) {
    fail(`room for ${engine.words} words against ${said("words")[0]}`);
  } else {
    ok(`room for ${engine.words} words`);
  }

  const drawn = table();
  const quad = engine.detect(drawn, TABLE.width, TABLE.height);
  if (!quad) {
    fail("no card on the table");
    continue;
  }
  const corners = bits(quad.flatMap((point) => [point.x, point.y]));
  if (corners.join() !== said("detect").join()) {
    fail(`corners ${corners.join(" ")} against ${said("detect").join(" ")}`);
  } else {
    ok(`a card at ${corners.join(" ")}`);
  }

  const card = engine.rectify(drawn, TABLE.width, TABLE.height, quad);
  const [wide, tall, first] = said("rectify") as [string, string, string];
  if (!card) {
    fail("the card did not read back");
  } else {
    const read = hex(
      engine.entry(card.levels, card.width, card.height)[0] as bigint,
    );
    const held = `${card.width} ${card.height} ${read}`;
    if (held !== `${wide} ${tall} ${first}`) {
      fail(`read back ${held} against ${wide} ${tall} ${first}`);
    } else {
      ok(`read back ${held}`);
    }
  }

  const asked = engine.query(drawn, TABLE.width, TABLE.height);
  const held = [
    String(asked.hashes.length),
    asked.quad ? "1" : "0",
    ...asked.hashes.map(hex),
  ];
  if (held.join() !== said("query").join()) {
    fail(`${held.length - 2} hashes against ${said("query").length - 2}`);
  } else {
    ok(
      `${asked.hashes.length} hashes, framed by ${asked.quad ? "a card" : "guesswork"}`,
    );
  }
}

console.log(failed ? "\nsomething disagrees" : "\nall green");
process.exit(failed ? 1 : 0);
