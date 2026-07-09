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

## Current Limits

- Castle only.
- One grass battlefield background.
- Obstacles, siege, hero spellbook, morale/luck and full attack execution are deferred.
- Two-hex creatures are displayed and marked, but still occupy one visual hex in V1.
- Uses `engine_verified_hd_variant` behavior as the maximum runtime tier; exact-build verification remains forbidden.
