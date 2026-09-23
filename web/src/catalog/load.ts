import { CATALOG } from "../config";
import { Catalog, type Entry, type Manifest, parts } from ".";
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
  const catalog = Catalog.read(
    new Uint8Array(cards.bytes),
    new Uint8Array(prints.bytes),
  );

  // Cached only now the pair it names is, or a later offline load would read a
  // manifest pointing at files this device never fetched. The sweep waits on
  // the same thing: it keeps what this manifest names, so running it while an
  // older one is cached takes away the pair that one points at.
  const held = cards.stored && prints.stored;
  const named =
    held && (!current.fresh || (await write(MANIFEST, current.bytes)));
  if (named) await prune(parts(manifest).map((part) => part.name));

  return { catalog, manifest, cached: cards.cached && prints.cached };
}

// An opt-in part, fetched when something needs it rather than with the pair,
// and cached under its own name like the rest so `load`'s sweep keeps it.
export async function part(entry: Entry): Promise<ArrayBuffer> {
  return (await file(entry.name)).bytes;
}

// From the network only, and deliberately not cached — see `load`.
export async function latest(): Promise<Manifest> {
  return parse<Manifest>(await fetchFile(MANIFEST, true));
}

// By filename, not version: one bulk file can rebuild to different bytes, and
// a part can be rebuilt while the pair beside it is not.
export function same(a: Manifest, b: Manifest): boolean {
  return names(a) === names(b);
}

function names(manifest: Manifest): string {
  return parts(manifest)
    .map((part) => part.name)
    .sort()
    .join();
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
// `cached` is where these bytes came from and `stored` is whether the disk
// holds them now, which are the same question only on the way in.
async function file(
  name: string,
): Promise<{ bytes: ArrayBuffer; cached: boolean; stored: boolean }> {
  const cached = await read(name);
  if (cached) return { bytes: cached, cached: true, stored: true };

  const bytes = await fetchFile(name);
  return { bytes, cached: false, stored: await write(name, bytes) };
}
