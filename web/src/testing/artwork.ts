// The artwork index as the exporter writes it, for tests that need one to
// read rather than one to assert about.

// What the engine answers for itself, which an index is read against.
export const HASHER = "1c1f64e991d4d1cc";

// Hashes per artwork, one framing each.
export const PER = 4;

// A header line padded so what follows is eight-byte aligned, the hashes,
// the back pairs, then the bitmap of which rows carry one.
export function file(
  artworks: (bigint[] | null)[],
  {
    fronts = artworks.length,
    backs = [] as [number, number][],
    hasher = HASHER,
  } = {},
): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(
    JSON.stringify({
      version: "v1",
      hasher,
      hashes: PER,
      rows: artworks.length,
      fronts,
      absent: artworks.filter((held) => held === null).length,
      backs: backs.length,
    }),
  );

  let pad = 0;
  while ((header.length + pad + 1) % 8 !== 0) pad++;
  const from = header.length + pad + 1;

  const bitmap = Math.ceil(artworks.length / 8);
  const bytes = new Uint8Array(
    from + artworks.length * PER * 8 + backs.length * 8 + bitmap,
  );
  bytes.set(header);
  bytes.fill(0x20, header.length, from - 1);
  bytes[from - 1] = 0x0a;

  const view = new DataView(bytes.buffer);
  let at = from;
  for (const held of artworks) {
    for (let which = 0; which < PER; which++) {
      view.setBigUint64(at, held?.[which] ?? held?.[0] ?? 0n, true);
      at += 8;
    }
  }
  for (const [back, front] of backs) {
    view.setUint32(at, back, true);
    view.setUint32(at + 4, front, true);
    at += 8;
  }
  for (const [which, held] of artworks.entries()) {
    if (held) {
      const byte = at + (which >> 3);
      bytes[byte] = (bytes[byte] as number) | (1 << (which & 7));
    }
  }

  return bytes;
}
