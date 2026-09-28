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

// Where `just serve` answers. The catalog passes through this server rather
// than being fetched from there directly, so the app has one origin in
// development and an HTTPS tunnel to it carries the catalog as well.
const BINARY = "http://127.0.0.1:8080";

// A tunnel answers on a host this server has never heard of, which it refuses
// by default. Comma-separated, or `any`.
const HOSTS = process.env.MANAWEB_DEV_HOSTS;

export default defineConfig(({ command }) => ({
  ...(command === "serve" ? { html: { cspNonce: NONCE } } : {}),
  server: {
    proxy: { "/catalog": BINARY },
    ...(HOSTS
      ? { allowedHosts: HOSTS === "any" ? true : HOSTS.split(",") }
      : {}),
  },
  plugins: [react(), worker(), headers(NONCE)],
}));
