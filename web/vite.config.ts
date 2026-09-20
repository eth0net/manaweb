import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { headers } from "./vite/headers";

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

export default defineConfig({
  plugins: [react(), worker(), headers()],
});
