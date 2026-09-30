# The icon takes a theme

What `bun run icons` draws and why, beside the code that draws it.
`just write-icons` is the recipe.

The drawing was already in the pieces it needed to be: three paths are the six
radial spokes, one is the inner ring, one is the outer. So the split was fills
plus a `clipPath` from the inner ring, which catches the lengths of spoke
inside it and makes those the crystal.

Twelve corners, alternating between radius 31 and radius 26 — six long points
with a shallow dent between each pair, which reads as a hexagon rather than the
circle a regular twelve-sided shape would. The points sit at the six spoke
angles, so the crystal terminates the spokes instead of crossing them.

Four tokens carry the whole thing: `--web`, `--core`, `--facet` and `--glow`,
set on the `svg` element so a page that inlines it can override them. A token
takes `url(#id)` as readily as a color, so a gradient preset needs the gradient
in `defs` and nothing else — the shape of a theme is already a row of four
values, whatever kind each one is.

`just write-icons` is the composer that follows from that. It resolves the
tokens to concrete fills, since the renderer reads no custom properties, then
adds a background and an inset, and writes every raster the app ships from the
one drawing.

Two of those exist for Android alone. A launcher crops a home screen icon to
whatever shape it uses and guarantees only the middle 80%, and it fills a
themed icon from the wallpaper after throwing away every color in it — so one
raster is inset on an opaque background and another is the silhouette, and
neither is what a browser tab wants. iOS takes its icon once, when the app is
added, and the dark alternative is offered through a media query the same way
the favicon's already is. Whether Safari reads it there is untested.

**A composed app icon is a shipped one, not a chosen one.** iOS fixes a PWA's
icon when it is added to the home screen, and a native app's alternates have to
be in the bundle and picked from a fixed list; Android can take a manifest
change but on its own schedule. So composing produces the set that ships, and
a live choice only reaches the surfaces the app draws itself — the header, and
the SVG the browser reads. The rasters are where a theme is baked in.
