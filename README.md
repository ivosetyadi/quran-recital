# Quran Recital — Slow Step

Slow, word-by-word Quran recitation with **synced highlighting** across three layers —
**Arabic**, **transliteration**, and **English** — for learning and memorization (hifz).

Click play on a surah and the page recites it slowly, lighting up each word as it's read.
Tap any word to jump to it. No app, no download — it runs in the browser.

**Live:** https://ivosetyadi.github.io/quran-recital/

## Features
- Word-by-word highlight synced to the recitation (Arabic + transliteration + English)
- Tap a word to jump & replay from there
- Previous / next ayah, auto-advance through the surah
- Speed control (0.75× / 1× / 1.25×)
- Deep links to a specific ayah (`#/1/1`)

## How it works
- Pure static site — HTML + CSS + vanilla JS, no backend, no build step.
- **Text & per-word timing**: bundled JSON in `data/{NNN}.json` (from the
  [Quran.com API](https://quran.com/api)).
- **Audio**: streamed from a public CDN (everyayah / Husary), not stored in this repo.
- **Sync**: on each animation frame, the active word is the one where
  `start ≤ audio.currentTime×1000 < end`.
- **Reciter**: Mahmoud Khalil al-Husary (Murattal) — slow and clear, recites each ayah once.

## Run locally
Any static server, e.g.:
```
npx serve .
# or
python -m http.server
```
Then open the printed URL.

## Add more surahs
Drop a `data/{NNN}.json` file (same shape as `data/001.json`) and add the surah to the
`SURAHS` list in `app.js`. Audio is resolved as `audioBase + {SSSAAA}.mp3`.

## Credits
- Quran text, per-word translation & timing: Quran.com
- Recitation audio: Mahmoud Khalil al-Husary, via everyayah.com
- Arabic font: Amiri Quran (Google Fonts)

## License
Code: MIT. Quran text and recitation audio belong to their respective sources — please
respect their terms.
