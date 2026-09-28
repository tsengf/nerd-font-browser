# Nerd Font Browser

A local web app for exploring the fonts on [Nerd Fonts Downloads](https://www.nerdfonts.com/font-downloads). It lists the 71 font families from Nerd Fonts v3.5.1, lets you filter and sort them, and opens a real font preview when you click a name. In the preview, press the up and down arrows to move through the **currently visible** rows.

## Run

Requires Python 3.9 or newer. No packages need to be installed.

```sh
python3 server.py
```

Open <http://127.0.0.1:8788>. The first preview of each font downloads its ZIP from the pinned Nerd Fonts release and caches one regular font file in `fonts/`. Later previews use that cache. The app is local; the browser only talks to this server.

## Table fields

- **Serif** comes from the font's OpenType family class, plus named overrides for fonts whose classification is missing or incorrect. Style categories are a guide; some fonts have only subtle serifs.
- **Nerd glyphs** is Yes for every row because this catalog contains patched Nerd Fonts. **Glyph count** is the font's OpenType `maxp` count.
- **Height at 16px** is `(hhea ascender - descender + line gap) / units per em × 16`. It represents the font's stated line metrics, not the visible height of a particular character.

The catalog and measured metadata are checked in, so the table works offline. Downloading an uncached font for preview requires internet access. Font files remain under their respective upstream licenses; this repository does not redistribute them.

## Test

```sh
python3 -m unittest discover -s tests -v
```
