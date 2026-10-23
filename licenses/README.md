# Licenses

Third-party material copied into this repository, as opposed to depended on. A
dependency carries its own license in its own package; what is here is material
that now lives in our files and so has to carry its license beside it.

|                     | what it covers                                                                        | license           |
| ------------------- | ------------------------------------------------------------------------------------- | ----------------- |
| `eva-icons-LICENSE` | the flip glyph drawn in `web/src/Printings.tsx`, which is Eva Icons' `flip-2` outline | MIT, © 2018 Akveo |

The glyph was taken as paths rather than as a file, so there is nothing in
`web/` named after it. It was checked against
[Eva Icons'
own copy](https://github.com/akveo/eva-icons/blob/master/package/icons/outline/svg/flip-2-outline.svg)
by rendering both and comparing the rasters, which matched exactly: the copy
that reached us had been re-encoded with relative path commands, so the text
differs and the drawing does not.

Everything a reader sees credited is in the app's own Licenses panel, which is
what the Fan Content Policy and Scryfall's terms are answered in — see
[`docs/ip.md`](../docs/ip.md).
