// Finds prose said twice: a comment restating what a doc already says, or one
// doc restating another.
//
//     bun run check
//
// The convention it holds to is that reasoning lives in `docs/` and a comment
// carries the one fact the code can't. A comment reproducing a paragraph is
// the failure, because the two then drift apart silently.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { Glob } from "bun";

process.chdir(dirname(dirname(import.meta.dir)));

// Eight words. Six catches ordinary domain phrasing, ten misses a restated
// sentence that changed a word.
const RUN = 8;

const MARKDOWN = ["*.md", "docs/*.md", "web/*.md", "lexicons/*.md"];

// Condensed by design — `AGENTS.md` says as much — so these repeat `docs/`
// legitimately. They still count as somewhere a comment shouldn't restate.
const SUMMARY = /^(AGENTS|CLAUDE|README|CONTRIBUTING)\.md$|README\.md$/;

const SOURCE = [
  "crates/**/*.rs",
  "web/src/**/*.ts",
  "web/src/**/*.tsx",
  "web/src/**/*.css",
  "tools/**/*.ts",
];

// Brace alternation isn't expanded, so patterns come one at a time.
const scan = (patterns: string[]) =>
  patterns.flatMap((pattern) => [...new Glob(pattern).scanSync(".")]);

let failed = false;
const fail = (message: string) => {
  console.log(`  FAIL  ${message}`);
  failed = true;
};

// Punctuation and backticked code drop out, so a phrase matches however it was
// wrapped or quoted.
function words(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Overlapping runs describe one passage, so matches merge into spans and each
// passage is reported once.
function spans(
  list: string[],
  source: (run: string) => string | undefined,
): { from: string; text: string }[] {
  const found: { from: string; text: string }[] = [];
  let from: string | undefined;
  let start = 0;
  let end = 0;

  const close = () => {
    if (from) found.push({ from, text: list.slice(start, end).join(" ") });
    from = undefined;
  };

  for (let at = 0; at + RUN <= list.length; at++) {
    const held = source(list.slice(at, at + RUN).join(" "));
    if (!held) continue;
    if (held !== from || at > end) {
      close();
      from = held;
      start = at;
    }
    end = at + RUN;
  }
  close();
  return found;
}

// Where each phrase was first seen, so a match names the file to cut against.
const seen = new Map<string, string>();
const docs = scan(MARKDOWN).sort();

console.log("docs:");
for (const file of docs) {
  const list = words(readFileSync(file, "utf8"));

  // A summary is allowed to repeat what it summarizes.
  if (!SUMMARY.test(file)) {
    for (const { from, text } of spans(list, (run) => {
      const held = seen.get(run);
      return held && held !== file && !SUMMARY.test(held) ? held : undefined;
    })) {
      fail(`${file} repeats ${from}: "${text}"`);
    }
  }

  for (let at = 0; at + RUN <= list.length; at++) {
    const run = list.slice(at, at + RUN).join(" ");
    if (!seen.has(run)) seen.set(run, file);
  }
}
if (!failed)
  console.log(`  ok    ${docs.length} files, none repeating another`);

// A comment block is a run of comment lines, reported by where it starts.
const COMMENT = /^\s*(?:\/\/\/?|\*|\/\*)\s?(.*?)\s*(?:\*\/)?$/;

console.log("\ncomments:");
let blocks = 0;
let repeats = 0;

for (const file of scan(SOURCE).sort()) {
  // Generated from `lexicons/`, whose descriptions the docs are free to
  // repeat: one owner still, just not this copy of it.
  if (file.includes("node_modules") || file.includes("src/lexicons/"))
    continue;

  const lines = readFileSync(file, "utf8").split("\n");
  let block: string[] = [];
  let start = 0;

  const close = () => {
    if (block.length) {
      blocks++;
      for (const { from, text } of spans(words(block.join(" ")), (run) =>
        seen.get(run),
      )) {
        fail(`${file}:${start} repeats ${from}: "${text}"`);
        repeats++;
      }
    }
    block = [];
  };

  lines.forEach((line, at) => {
    const found = COMMENT.exec(line);
    if (found?.[1] && /^\s*(?:\/\/|\*|\/\*)/.test(line)) {
      if (!block.length) start = at + 1;
      block.push(found[1]);
    } else {
      close();
    }
  });
  close();
}

if (!repeats) {
  console.log(`  ok    ${blocks} comment blocks, none restating a doc`);
}

console.log(failed ? "\nFAILED" : "\nall green");
process.exit(failed ? 1 : 0);
