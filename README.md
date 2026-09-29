# Nerd Font Browser

A local web app for exploring the fonts on [Nerd Fonts Downloads](https://www.nerdfonts.com/font-downloads). It lists the 71 font families from Nerd Fonts v3.5.1 on the left and shows a live preview on the right. Click a font name to select it; use Up and Down to move through fonts, and Left and Right to move between rounds. The arrow keys keep their normal editing behavior in the size and text fields. The left pane also has buttons for moving between rounds.

The five columns beside each font record round decisions. Click a round cell to toggle rejection for that font and round. You can also press **X**, or click **X Reject** beside Previous and Next, to toggle rejection for the selected font in the current round. Click a round heading to switch rounds. In later rounds, every font that has not been rejected remains available. Decisions, the current round and font, preview size, and custom sample text are saved in your browser's local storage so you can resume after closing the app.

## Run

Requires Python 3.9 or newer. No packages need to be installed.

```sh
./server.py
```

Open <http://127.0.0.1:8788>. The first preview of each font downloads its ZIP from the pinned Nerd Fonts release and caches one regular font file in `fonts/`. Later previews use that cache. The app is local; the browser only talks to this server.

The code preview uses the same `snippet.c` sample as Nerd Font Ranker.

## Preview details

- **Serif** comes from the font's OpenType family class, plus named overrides for fonts whose classification is missing or incorrect. Style categories are a guide; some fonts have only subtle serifs.
- **Glyph count** is the font's OpenType `maxp` count.
- **Line height** is `(hhea ascender - descender + line gap) / units per em × preview size`. It represents the font's stated line metrics, not the visible height of a particular character.

The catalog and measured metadata are checked in, so the font list works offline. Downloading an uncached font for preview requires internet access. Font files remain under their respective upstream licenses; this repository does not redistribute them.

## Test

```sh
python3 -m unittest discover -s tests -v
```
