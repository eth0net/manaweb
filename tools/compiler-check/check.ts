// Finds the components the React Compiler skipped.
//
//     bun run check
//
// It skips a function whose syntax it does not handle and says nothing, so a
// hook that silently stopped being memoized reads exactly like one that never
// was. This asks the compiler itself, with the configuration the build uses.

import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { Glob } from "bun";
import { SKIPPED } from "./skipped";

process.chdir(dirname(dirname(import.meta.dir)));

// Resolved against the web package, which is what declares them: the build
// runs this same plugin, so a disagreement here would be about nothing.
const WEB = resolve("web");
const required = createRequire(`${WEB}/package.json`);
const { transformAsync } = required("@babel/core");
const imported = required("babel-plugin-react-compiler");
const compiler = imported.default ?? imported;

// Brace alternation isn't expanded, so patterns come one at a time.
const SOURCE = ["src/**/*.ts", "src/**/*.tsx"];

interface Skipped {
  file: string;
  line: number | string;
  why: string;
}

const skipped: Skipped[] = [];
let compiled = 0;

const logger = {
  logEvent(file: string, event: Record<string, never>) {
    const kind = event.kind as unknown as string;
    if (kind === "CompileSuccess") {
      compiled += 1;
      return;
    }
    if (kind !== "CompileError" && kind !== "CompileSkip") return;
    const detail = event.detail as Record<string, string> | undefined;
    const where = event.fnLoc as { start?: { line: number } } | undefined;
    skipped.push({
      file: relative(".", file),
      line: where?.start?.line ?? "?",
      why: detail?.reason ?? detail?.description ?? event.reason ?? kind,
    });
  },
};

for (const pattern of SOURCE) {
  for (const found of new Glob(pattern).scanSync(WEB)) {
    const file = resolve(WEB, found);
    const source = await Bun.file(file).text();
    try {
      await transformAsync(source, {
        filename: file,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ["typescript", "jsx"] },
        // Logged rather than thrown, so one unhandled file doesn't hide the
        // rest of them.
        plugins: [[compiler, { logger, panicThreshold: "none" }]],
      });
    } catch (thrown) {
      skipped.push({
        file: relative(".", file),
        line: "?",
        why: `${thrown}`.split("\n")[0] ?? "threw",
      });
    }
  }
}

// Counted per file and message, because a line number moves with every edit
// above it and would make the list churn for nothing.
const seen = new Map<string, Skipped[]>();
for (const one of skipped) {
  const key = `${one.file}\u0000${one.why}`;
  seen.set(key, [...(seen.get(key) ?? []), one]);
}

let failed = false;
const fail = (message: string) => {
  console.log(`  FAIL  ${message}`);
  failed = true;
};

console.log("components:");

for (const allowed of SKIPPED) {
  const key = `${allowed.file}\u0000${allowed.why}`;
  const found = seen.get(key) ?? [];
  seen.delete(key);
  if (found.length === 0) {
    fail(`${allowed.file} no longer skipped: drop it from skipped.ts`);
  } else if (found.length !== allowed.count) {
    fail(
      `${allowed.file} skipped ${found.length} times, skipped.ts says ${allowed.count}: ${allowed.why}`,
    );
  }
}

for (const [, found] of seen) {
  for (const one of found) {
    fail(`${one.file}:${one.line} newly skipped: ${one.why}`);
  }
}

if (failed) {
  console.log(`\n${skipped.length} skipped, ${compiled} compiled`);
  process.exit(1);
}

const allowed = SKIPPED.reduce((count, one) => count + one.count, 0);
console.log(`  ok    ${compiled} compiled, ${allowed} skipped with a reason`);
