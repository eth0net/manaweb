// Writes the fixture records into a dev account, so a repo with something in
// it needs no clicking through the UI.
//
//     bun run seed <handle> [dir]
//
// `goat` does the writing and holds the session; this decides what is written
// and in what order. Run `goat account login` first.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Glob } from "bun";

process.chdir(dirname(dirname(import.meta.dir)));

// Every at-uri in the fixtures names the primary author, and is rewritten to
// whichever account this writes to.
const AUTHOR = "did:plc:rk2rhs4yvucutbrd2aoi5gci";

// A card names its container, so the container has to be there to name.
const CONTAINER = "app.manaweb.container";

function stop(why: string): never {
  console.error(`  FAIL  ${why}`);
  process.exit(1);
}

async function goat(args: string[], stdin?: string) {
  const run = Bun.spawn(["goat", ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
  ]);
  return { code: await run.exited, out: out.trim(), err: err.trim() };
}

const [handle, dir = "fixtures/records"] = process.argv.slice(2);
if (!handle) stop("usage: bun run seed <handle> [dir]");

if (!Bun.which("goat")) {
  stop("no goat: go install github.com/bluesky-social/goat@latest");
}

const found = await goat(["resolve", "--did", handle as string]);
if (found.code !== 0) stop(`${handle}: ${found.err}`);
const did = found.out;

// goat writes as whoever it is logged in as and the handle only decides whose
// DID the records name, so a mismatch seeds the wrong repo and says nothing.
const signed = await goat(["account", "check-auth"]);
if (signed.code !== 0) stop(`${signed.err}. Run \`goat account login\``);

const session = signed.out
  .split("\n")
  .find((line) => line.startsWith("DID:"))
  ?.slice("DID:".length)
  .trim();
if (session !== did) stop(`logged in as ${session}, not ${handle} (${did})`);

// Containers first, so anything reading as this lands sees a card's place
// before the card naming it.
const files = [...new Glob("*/*.json").scanSync(dir)].sort((a, b) => {
  const first = (one: string) => (dirname(one) === CONTAINER ? 0 : 1);
  return first(a) - first(b) || a.localeCompare(b);
});
if (files.length === 0) stop(`no records under ${dir}`);

for (const file of files) {
  const collection = dirname(file);
  const rkey = file.slice(file.lastIndexOf("/") + 1, -".json".length);
  const record = readFileSync(join(dir, file), "utf8").replaceAll(AUTHOR, did);

  // A create refuses a key already there, and these keys are fixed.
  await goat(["record", "delete", "-c", collection, "-r", rkey]);
  const written = await goat(["record", "create", "-r", rkey, "-"], record);
  if (written.code !== 0) stop(`${collection}/${rkey}: ${written.err}`);

  console.log(
    `  ok    ${written.out.split(/\s+/)[0] ?? `${collection}/${rkey}`}`,
  );
}

console.log(`\n${files.length} records on ${did}`);
