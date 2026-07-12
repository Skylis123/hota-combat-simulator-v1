# HotA Combat Simulator V1

Standalone web prototype for the HotA combat AI simulator. This folder is intentionally separate from the reverse-engineering workspace so only the web app can be versioned or published.

## Scope

- Castle-only pre-battle setup.
- 15x11 visible battlefield grid, 165 playable visual hexes.
- Castle creature list from extracted simulator data.
- Drag/drop stack placement with Player/AI ownership.
- Start Battle, turn order, movement preview, Wait, Defend, Reset, Clear.
- Creature visual fallback: idle GIF, preview PNG, placeholder.

## Local Run

```bash
npm run dev
```

Then open the printed local URL.

## Build

```bash
npm run build
```

The static site is copied to `dist/` and is ready for GitHub Pages.

## Data Refresh

From this folder:

```bash
npm run prepare:data
```

This reads the parent workspace exports and copies only the Castle V1 subset into `public/`.

## Screenshot Import

Screenshot recognition uses a candidate-first pipeline designed to scale beyond the current Castle roster:

1. Normalize the battlefield to the canonical 165-hex coordinate system.
2. Detect the original purple stack badges and read counts with the game's bitmap digit glyphs.
3. Build Player/AI anchor and facing hypotheses from badge geometry.
4. Shortlist creatures with three representative DEF frames.
5. Verify only the best candidates against every relevant frame with alpha-aware pixel matching.
6. Detect obstacle candidates coarsely, refine the best legal anchors, and preserve their exact detected render coordinates.

The two regression screenshots currently analyze in roughly 2.5–3 seconds cold on the local test device, compared with 11–12 seconds for the previous exhaustive matcher. A future all-faction classifier can replace only the shortlist stage with an ONNX model while retaining exact DEF and hex verification.

## Current Limits

- Castle only.
- All 25 extracted Heroes III combat backgrounds.
- 125 battle obstacles with terrain categories, blocked-hex footprints, manual placement and original-style automatic layouts.
- Screenshot import by file or Ctrl+V, with local background, obstacle, unit and bitmap-count analysis.
- Screenshot counts use the original game bitmap digits; general native OCR is intentionally avoided because it confuses the tiny 1/5/6 glyphs.
- Siege, hero spellbook, morale/luck and some non-Castle behavior are deferred.
- Two-hex creatures use explicit front/rear footprints for placement, movement and screenshot import.
- Uses `engine_verified_hd_variant` behavior as the maximum runtime tier; exact-build verification remains forbidden.
