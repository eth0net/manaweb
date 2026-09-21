// The drawing is one file with four colors in it, so an appearance is a row of
// four values and what a raster bakes in — see `docs/roadmap.md`.
//
// The tokens are rewritten to concrete fills rather than left as custom
// properties, which the renderer here does not resolve.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..", "web", "public");

/** The box the drawing is authored in. */
const BOX = 128;

interface Look {
  web: string;
  core: string;
  facet: string;
  /** Empty drops the halo, which has no alpha a mask could use. */
  glow: string;
  /** Behind the drawing; absent leaves it transparent. */
  paper?: string;
  /** How much of the box the drawing takes, centered. */
  fill?: number;
}

const LIGHT: Look = {
  web: "#5e6367",
  core: "#4e3bb0",
  facet: "#a99cea",
  glow: "#6d5bd0",
};

const DARK: Look = {
  web: "#9a9a97",
  core: "#c9baff",
  facet: "#5b4da8",
  glow: "#a08cf7",
};

// A launcher keeps only the alpha and fills it with the wallpaper's own color,
// so every part of the drawing has to be the one shape.
const MONO: Look = { web: "#000", core: "#000", facet: "#000", glow: "" };

const PAPER = "#fdfdfc";
const INK = "#16161a";

// Android's masks range from a circle to a rounded square, and the circle is
// the one that crops: the guaranteed area is the middle 80%.
const SAFE = 0.8;

const RASTERS: { name: string; size: number; look: Look }[] = [
  { name: "favicon-16x16.png", size: 16, look: LIGHT },
  { name: "favicon-32x32.png", size: 32, look: LIGHT },
  { name: "android-chrome-192x192.png", size: 192, look: LIGHT },
  { name: "android-chrome-512x512.png", size: 512, look: LIGHT },
  {
    name: "apple-touch-icon.png",
    size: 180,
    look: { ...LIGHT, paper: PAPER },
  },
  {
    name: "apple-touch-icon-dark.png",
    size: 180,
    look: { ...DARK, paper: INK },
  },
  {
    name: "icon-maskable.png",
    size: 512,
    look: { ...LIGHT, paper: PAPER, fill: SAFE },
  },
  { name: "icon-mono.png", size: 512, look: { ...MONO, fill: SAFE } },
];

/** The source with its tokens resolved, on a background, at a size. */
function compose(source: string, look: Look): string {
  const style = [
    `.web{fill:${look.web}}`,
    `.core{fill:${look.core}}`,
    `.facet{fill:${look.facet}}`,
    look.glow
      ? `#glow stop{stop-color:${look.glow}}`
      : "#glow stop{stop-opacity:0}",
  ].join("");

  let svg = source.replace(
    /<style>[\s\S]*?<\/style>/,
    `<style>${style}</style>`,
  );
  if (svg.includes("--web")) {
    throw new Error("the style block moved, so the theme was not applied");
  }

  if (look.fill) {
    const edge = (BOX * (1 - look.fill)) / 2;
    svg = svg.replace(
      /(<svg[^>]*>)([\s\S]*)(<\/svg>)/,
      `$1<g transform="translate(${edge} ${edge}) scale(${look.fill})">$2</g>$3`,
    );
  }

  if (look.paper) {
    svg = svg.replace(
      /(<svg[^>]*>)/,
      `$1<rect width="${BOX}" height="${BOX}" fill="${look.paper}"/>`,
    );
  }

  return svg;
}

/** An ICO is a directory and the PNG files themselves, so nothing re-encodes. */
function ico(pngs: { size: number; png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + pngs.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);

  let at = head.length;
  pngs.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    head.writeUInt8(size, entry);
    head.writeUInt8(size, entry + 1);
    head.writeUInt16LE(1, entry + 4);
    head.writeUInt16LE(32, entry + 6);
    head.writeUInt32LE(png.length, entry + 8);
    head.writeUInt32LE(at, entry + 12);
    at += png.length;
  });

  return Buffer.concat([head, ...pngs.map(({ png }) => png)]);
}

const source = await readFile(join(PUBLIC, "icon.svg"), "utf8");
await mkdir(PUBLIC, { recursive: true });

const drawn = new Map<string, Buffer>();
for (const { name, size, look } of RASTERS) {
  const png = new Resvg(compose(source, look), {
    fitTo: { mode: "width", value: size },
  })
    .render()
    .asPng();
  drawn.set(name, png);
  await writeFile(join(PUBLIC, name), png);
  console.log(`${name} ${size}px ${png.length} bytes`);
}

const legacy = ico(
  [16, 32].map((size) => ({
    size,
    png: drawn.get(`favicon-${size}x${size}.png`) as Buffer,
  })),
);
await writeFile(join(PUBLIC, "favicon.ico"), legacy);
console.log(`favicon.ico 16+32px ${legacy.length} bytes`);
