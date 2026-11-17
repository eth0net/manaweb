// The stamp's module, which Vite makes and a test runner has no way to
// resolve. Registered rather than mocked: a specifier nothing on disk backs
// fails before a mock is consulted, so any render reaching `About` needs it.
import { plugin } from "bun";

plugin({
  name: "built",
  setup(build) {
    build.module("virtual:built", () => ({
      exports: { at: "2026-01-01T00:00:00.000Z", rev: "v0.0.0-0-g0000000" },
      loader: "object",
    }));
  },
});
