import { CATALOG } from "../config";
import { Catalog, type Manifest } from ".";
import { MANIFEST, prune, read, write } from "./store";

export interface Loaded {
  catalog: Catalog;
  manifest: Manifest;
  // Off disk rather than the network.
  cached: boolean;
}

// Reports each step, the first load being megabytes.
export async function load(step: (of: string) => void): Promise<Loaded> {
  step("Reading the manifest");
  const current = await readManifest();
  const manifest = current.manifest;

  step(`Loading ${manifest.cards.rows.toLocaleString()} cards`);
  const [cards, prints] = await Promise.all([
    file(manifest.cards.name),
    file(manifest.prints.name),
  ]);

  step("Indexing");
  const decoder = new TextDecoder();
  const catalog = Catalog.read(
    decoder.decode(cards.bytes),
    decoder.decode(prints.bytes),
  );

  // Cached only now the pair it names is, or a later offline load would read a
  // manifest pointing at files this device never fetched.
  if (current.fresh) await write(MANIFEST, current.bytes);
  await prune([manifest.cards.name, manifest.prints.name]);

  return { catalog, manifest, cached: cards.cached && prints.cached };
}

// From the network only, and deliberately not cached — see `load`.
export async function latest(): Promise<Manifest> {
  return parse<Manifest>(await fetchFile(MANIFEST, true));
}

// By filename, not version: one bulk file can rebuild to different bytes.
export function same(a: Manifest, b: Manifest): boolean {
  return a.cards.name === b.cards.name && a.prints.name === b.prints.name;
}

function parse<T>(bytes: ArrayBuffer): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function fetchFile(
  name: string,
  revalidate = false,
): Promise<ArrayBuffer> {
  const at = new URL(name, `${CATALOG}/`);
  const response = await fetch(at, revalidate ? { cache: "no-cache" } : {});
  if (!response.ok) {
    throw new Error(`${at}: ${response.status} ${response.statusText}`);
  }
  return await response.arrayBuffer();
}

// The one file that changes under its own name: network first, then cache.
async function readManifest(): Promise<{
  manifest: Manifest;
  bytes: ArrayBuffer;
  fresh: boolean;
}> {
  try {
    const bytes = await fetchFile(MANIFEST, true);
    return { manifest: parse<Manifest>(bytes), bytes, fresh: true };
  } catch (error) {
    const bytes = await read(MANIFEST);
    if (!bytes) throw error;
    return { manifest: parse<Manifest>(bytes), bytes, fresh: false };
  }
}

// Content-addressed, so a cached file under this name needs no revalidating.
async function file(
  name: string,
): Promise<{ bytes: ArrayBuffer; cached: boolean }> {
  const cached = await read(name);
  if (cached) return { bytes: cached, cached: true };

  const bytes = await fetchFile(name);
  await write(name, bytes);
  return { bytes, cached: false };
}
