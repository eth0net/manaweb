// Keeping what a phone's camera saw. `apply: "serve"` is the whole of why
// this exists at all: there is no build hook here, so nothing that deploys
// can carry it.

import { mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { CAPTURE } from "../src/scan/capture.ts";

// What one post, and one run of the dev server, can spend — `docs/scanner.md`.
const MOST = 12 * 1024 * 1024;
const LIMIT = 500;

// The eight bytes every PNG opens with, checked so that this is not
// somewhere to write an arbitrary file.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const KEPT = fileURLToPath(new URL("../../local/captures", import.meta.url));

// Sortable, and the counter separates two frames taken inside a second.
export function stamped(at: Date, nth: number): string {
  const when = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${when}-${String(nth).padStart(3, "0")}`;
}

// The frame and the note as two files sharing a stem. Throws rather than
// writing anything where the body is not a capture.
export function keep(dir: string, body: Buffer, stem: string): void {
  const held: unknown = JSON.parse(body.toString("utf8"));
  if (typeof held !== "object" || held === null) {
    throw new Error("A capture is an object");
  }
  const { note, png } = held as { note?: unknown; png?: unknown };
  if (typeof png !== "string") throw new Error("A capture carries a frame");
  const bytes = Buffer.from(png, "base64");
  if (!bytes.subarray(0, PNG.length).equals(PNG)) {
    throw new Error("That frame is not a PNG");
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stem}.png`), bytes);
  writeFileSync(
    join(dir, `${stem}.json`),
    `${JSON.stringify(note ?? {}, null, 2)}\n`,
  );
}

export function captures(dir = KEPT): Plugin {
  let nth = 0;

  return {
    name: "manaweb-captures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(CAPTURE, (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        if (nth >= LIMIT) {
          said(response, 429, `${LIMIT} captures is one run's lot`);
          return;
        }
        nth += 1;
        const stem = stamped(new Date(), nth);
        body(request)
          .then((held) => {
            keep(dir, held, stem);
            server.config.logger.info(`capture ${stem}`);
            response.statusCode = 204;
            response.end();
          })
          .catch((failed: unknown) => {
            said(response, 400, failed instanceof Error ? failed.message : "");
          });
      });
    },
  };
}

function said(response: ServerResponse, code: number, why: string): void {
  response.statusCode = code;
  response.setHeader("content-type", "text/plain");
  response.end(why);
}

function body(request: IncomingMessage): Promise<Buffer> {
  return new Promise((keep, refuse) => {
    const held: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MOST) {
        refuse(new Error(`A capture stops at ${MOST} bytes`));
        request.destroy();
        return;
      }
      held.push(chunk);
    });
    request.on("end", () => keep(Buffer.concat(held)));
    request.on("error", refuse);
  });
}
