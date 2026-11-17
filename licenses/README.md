# Licenses

Third-party material copied into this repository, as opposed to depended on. A
dependency carries its own license in its own package; what is here is material
that now lives in our files and so has to carry its license beside it.

|                     | what it covers                                                                           | license           |
| ------------------- | ---------------------------------------------------------------------------------------- | ----------------- |
| `eva-icons-LICENSE` | the flip glyph drawn in `web/src/Printings.tsx`, which is Eva Icons' `flip-2` outline    | MIT, © 2018 Akveo |
| no file             | the marks drawn in `web/src/Nav.tsx` and `web/src/scan/Review.tsx`, which are Iconcino's | CC0 1.0           |

The glyph was taken as paths rather than as a file, so there is nothing in
`web/` named after it. It was checked against
[Eva Icons'
own copy](https://github.com/akveo/eva-icons/blob/master/package/icons/outline/svg/flip-2-outline.svg)
by rendering both and comparing the rasters, which matched exactly: the copy
that reached us had been re-encoded with relative path commands, so the text
differs and the drawing does not.

The nine marks are from
[Iconcino Interface
Icons](https://www.svgrepo.com/collection/iconcino-interface-icons/),
taken as paths rather than as files: `search`, `box`, `camera`,
`screenshot-smartphone` and `smartphone-02` in the tab bar, `edit-03`,
`delete-2`, `undo` and `close` on a row of the review. Each drawing is the one
that was handed out — the stroke color became `currentcolor` and the stroke
attributes moved to a single `.stroked` rule, so the geometry is theirs and the
weight is the page's. CC0 waives the conditions a notice would carry, which is
why there is no file here to keep beside them.

Everything a reader sees credited is in the app's own Licenses panel, which is
what the Fan Content Policy and Scryfall's terms are answered in — see
[`docs/ip.md`](../docs/ip.md).
