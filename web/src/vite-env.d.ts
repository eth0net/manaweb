/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Where a handle is resolved, for an install that would rather not ask
  // Bluesky — `docs/configuration.md`.
  readonly MANAWEB_WEB_RESOLVER?: string;
}
