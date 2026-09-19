// Regenerates `web/src/lexicons` from `lexicons/`, keeping the declarations
// and dropping the runtime half. The client reads records with these types;
// what a record may be is the PDS's answer, not the browser's.
//
//     bun install && bun run gen              rewrite in place
//     bun install && bun run gen --check      fail once it has drifted
//
// Schemas we reference but do not own come from `@atproto/api`, which carries
// every official one, so nothing is copied into this repo to go stale.

import { lexicons } from "@atproto/api";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const ROOT = dirname(dirname(import.meta.dir));
const SOURCE = join(ROOT, "lexicons");
const TARGET = join(ROOT, "web/src/lexicons");
const OURS = "app.manaweb.";

const check = process.argv.includes("--check");

// Every NSID a schema of ours points at that is not also ours.
function borrowed(): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if ((key === "ref" || key === "refs") && typeof value === "string") {
        const nsid = value.split("#")[0] as string;
        if (nsid && !nsid.startsWith(OURS)) found.add(nsid);
      } else {
        walk(value);
      }
    }
  };
  for (const file of readdirSync(SOURCE).filter((f) => f.endsWith(".json"))) {
    walk(JSON.parse(readFileSync(join(SOURCE, file), "utf8")));
  }
  return [...found].sort();
}

// Keeps the type declarations and the sibling imports they need, so what is
// left compiles with no dependency and disappears from the bundle entirely.
function declarations(source: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];

  let at = 0;
  for (; at < lines.length; at++) {
    const line = lines[at] as string;
    if (line.startsWith("export ") || line.startsWith("const ")) break;
    if (line.startsWith("import type * as ")) kept.push(line);
  }
  if (kept.length > 0) kept.push("");

  for (const block of lines.slice(at).join("\n").split("\n\n")) {
    if (/^(\/\*[\s\S]*?\*\/\n)?export (interface|type) /.test(block)) {
      kept.push(`${block.trimEnd()}\n`);
    }
  }

  // `BlobRef` is a class in `@atproto/lexicon`, which is the runtime half this
  // drops. What arrives over the wire is the reference rather than the bytes,
  // so the structural form is both what a reader gets and what compiles here.
  const text = kept.join("\n").trimEnd();
  if (/\bBlobRef\b/.test(text)) {
    return `${BLOB}\n\n${text}\n`;
  }
  return `${text}\n`;
}

const BLOB = `export interface BlobRef {
  $type: 'blob'
  ref: { $link: string }
  mimeType: string
  size: number
}`;

async function sources(dir: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true })) {
    const path = join(dir, entry);
    if (entry.endsWith(".ts") && statSync(path).isFile()) {
      found.set(entry, readFileSync(path, "utf8"));
    }
  }
  return found;
}

const work = mkdtempSync(join(tmpdir(), "manaweb-lex-"));
try {
  const docs = join(work, "docs");
  await mkdir(docs, { recursive: true });

  for (const nsid of borrowed()) {
    // Keyed by lexicon URI rather than by NSID.
    const doc = lexicons.docs.get(`lex:${nsid}`);
    if (!doc) throw new Error(`${nsid} is referenced and @atproto/api has none`);
    await writeFile(join(docs, `${nsid}.json`), JSON.stringify(doc));
  }

  const out = join(work, "out");
  const ours = readdirSync(SOURCE)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(SOURCE, f));
  const theirs = readdirSync(docs).map((f) => join(docs, f));

  const lex = Bun.spawnSync(
    ["bunx", "lex", "gen-api", out, ...ours, ...theirs, "--yes"],
    { cwd: import.meta.dir, stderr: "pipe" },
  );
  if (!lex.success) throw new Error(lex.stderr.toString());

  const types = join(out, "types");
  const written = new Map<string, string>();
  for (const [path, source] of await sources(types)) {
    written.set(path, declarations(source));
  }

  if (check) {
    const held = await sources(TARGET);
    const names = new Set([...written.keys(), ...held.keys()]);
    const wrong = [...names].filter((n) => written.get(n) !== held.get(n));
    if (wrong.length > 0) {
      console.error(`stale, rerun \`just lexicon-types\`:\n  ${wrong.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`  ok    ${written.size} files match \`${relative(ROOT, SOURCE)}\``);
  } else {
    rmSync(TARGET, { recursive: true, force: true });
    for (const [path, source] of written) {
      await mkdir(dirname(join(TARGET, path)), { recursive: true });
      await writeFile(join(TARGET, path), source);
    }
    console.log(`  wrote ${written.size} files to ${relative(ROOT, TARGET)}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
