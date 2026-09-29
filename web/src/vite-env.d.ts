/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Where a handle is resolved, for an install that would rather not ask
  // Bluesky — `docs/configuration.md`.
  readonly VITE_RESOLVER?: string;
}
