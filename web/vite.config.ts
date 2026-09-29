import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { headers } from "./vite/headers.ts";

// Only the dev server sends one; the build has no inline script to allow.
const NONCE = createHash("sha256")
  .update(String(Date.now()))
  .digest("hex")
  .slice(0, 22);

// The shell is what the build emits plus what the document names, and the
// version is a hash of that list, so an unchanged build keeps its cache.
function worker(): Plugin {
  const ROOTS = ["/", "/index.html", "/icon.svg", "/site.webmanifest"];

  return {
    name: "manaweb-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const emitted = Object.keys(bundle).map((name) => `/${name}`);
      const shell = [...ROOTS, ...emitted];
      const version = createHash("sha256")
        .update(shell.join("\n"))
        .digest("hex")
        .slice(0, 16);

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: readFileSync("sw.js", "utf8")
          .replace("__VERSION__", version)
          .replace("__SHELL__", JSON.stringify(shell, null, 2)),
      });
    },
  };
}

// Where `just serve` answers, and what `/catalog` is passed through to.
const BINARY = "http://127.0.0.1:8080";

// A tunnel answers on a host this server has never heard of, which it refuses
// by default. Comma-separated, or `any` — which turns the check off, and what
// that costs is `docs/configuration.md`.
const HOSTS = process.env.MANAWEB_DEV_HOSTS;

export default defineConfig(({ command }) => ({
  ...(command === "serve" ? { html: { cspNonce: NONCE } } : {}),
  server: {
    proxy: { "/catalog": BINARY },
    // A lockfile at the repo root makes that the root of what this would
    // otherwise serve over `/@fs/`, which is the database, the notes and
    // everything else beside the app. It reads the app and what the app
    // imports, so that is what it is allowed.
    fs: { allow: [".", "../node_modules"] },
    ...(HOSTS
      ? {
          allowedHosts:
            HOSTS === "any"
              ? true
              : HOSTS.split(",")
                  .map((one) => one.trim())
                  .filter(Boolean),
        }
      : {}),
  },
  plugins: [react(), worker(), headers(NONCE)],
}));
