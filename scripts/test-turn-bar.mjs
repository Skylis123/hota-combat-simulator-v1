import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { createCanvas, Image: CanvasImage, loadImage } = require("@napi-rs/canvas");
const root = path.resolve(import.meta.dirname, "..");

class LocalImage extends CanvasImage {
  set src(value) {
    const resolved = typeof value === "string" && value.startsWith("./public/")
      ? path.join(root, value.slice(2))
      : value;
    super.src = typeof resolved === "string" ? fs.readFileSync(resolved) : resolved;
    this.decode().then(() => this.onload?.(), (error) => this.onerror?.(error));
  }
}

globalThis.document = {
  createElement(tagName) {
    if (tagName !== "canvas") throw new Error(`Unsupported test element: ${tagName}`);
    return createCanvas(1, 1);
  }
};
globalThis.Image = LocalImage;

const { detectBattleWindowBounds, detectTurnBarRoster } = await import(pathToFileURL(path.join(root, "src/engine/turnBarAnalyzer.js")));
const simulator = JSON.parse(fs.readFileSync(path.join(root, "public/data/simulator-v1-data.json"), "utf8"));
const factory = JSON.parse(fs.readFileSync(path.join(root, "public/data/factory-creatures.json"), "utf8"));
const neutral = JSON.parse(fs.readFileSync(path.join(root, "public/data/neutral-creatures.json"), "utf8"));
const detection = JSON.parse(fs.readFileSync(path.join(root, "public/assets/creatures/detection/manifest.json"), "utf8"));
const data = { ...simulator, creatures: [...simulator.creatures, ...factory.creatures, ...neutral.creatures], creatureDetection: detection };
const source = await loadImage(fs.readFileSync(path.resolve(process.argv[2])));
const battleWindow = detectBattleWindowBounds(source);
if (process.argv.includes("--bounds-only")) {
  console.log(JSON.stringify(battleWindow, null, 2));
  process.exit(0);
}
const result = await detectTurnBarRoster(source, data, {
  preserveAiPortraitColor: !process.argv.includes("--grayscale-ai")
});
const summary = result.entries.map(({ owner, creatureName, count, segment, confidence, margin }) => ({
  owner,
  creature: creatureName,
  count,
  segment,
  confidence: Number(confidence.toFixed(3)),
  margin: Number(margin.toFixed(3))
}));
console.log(JSON.stringify({
  detected: result.detected,
  roundBreakIndex: result.roundBreakIndex,
  entries: summary,
  patterns: result.patterns,
  lowerBoundRoster: result.lowerBoundRoster,
  geometry: result.geometry,
  battleWindow
}, null, 2));

if (process.argv.includes("--assert-reference")) {
  const expected = [
    "player:Marksman:22", "player:Griffin:6",
    "player:Pikeman:20", "player:Pikeman:1", "player:Pikeman:1", "player:Pikeman:1", "player:Pikeman:1",
    "ai:Cavalier:6", "player:Marksman:22", "player:Griffin:6",
    "player:Pikeman:20", "player:Pikeman:1", "player:Pikeman:1", "player:Pikeman:1"
  ];
  const actual = summary.map(({ owner, creature, count }) => `${owner}:${creature}:${count}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected turn bar: ${actual.join(", ")}`);
  }
  if (result.roundBreakIndex !== 7) throw new Error(`Unexpected round divider: ${result.roundBreakIndex}`);
}

if (process.argv.includes("--assert-archangel-reference")) {
  assertRoster([
    "player:Archangel:5:6",
    "ai:Crusader:17:2"
  ]);
  if (result.roundBreakIndex !== 8) throw new Error(`Unexpected round divider: ${result.roundBreakIndex}`);
}

if (process.argv.includes("--assert-champion-reference")) {
  assertRoster([
    "player:Archangel:5:6",
    "ai:Champion:15:1"
  ]);
  if (result.roundBreakIndex !== 7) throw new Error(`Unexpected round divider: ${result.roundBreakIndex}`);
}

if (process.argv.includes("--assert-desert-reference")) {
  assertRoster([
    "player:Archangel:5:6",
    "ai:Angel:26:1"
  ]);
  if (result.roundBreakIndex !== 7) throw new Error(`Unexpected round divider: ${result.roundBreakIndex}`);
}

if (process.argv.includes("--assert-unknown-reference")) {
  const pikemen = summary.filter(({ owner, creature, count }) => owner === "player" && creature === "Pikeman" && count === 1);
  const unknownAi = summary.filter(({ owner, creature }) => owner === "ai" && creature === null);
  if (pikemen.length !== 7 || unknownAi.length !== 7) {
    throw new Error(`Expected seven Pikemen and seven unknown AI cards, got ${pikemen.length}/${unknownAi.length}`);
  }
  if (unknownAi.some(({ confidence }) => confidence >= 0.45)) {
    throw new Error("An unknown creature crossed the conservative recognition threshold.");
  }
}

if (process.argv.includes("--assert-hota-halberdier-mixed")) {
  assertRoster([
    "player:Archangel:20:1",
    "ai:Archangel:10:1",
    "player:Griffin:4:1",
    "player:Halberdier:1:1",
    "player:Pikeman:12:1",
    "player:Archer:5:1",
    "player:Pikeman:1:2"
  ]);
  if (result.roundBreakIndex !== 8) throw new Error(`Unexpected round divider: ${result.roundBreakIndex}`);
}

if (process.argv.includes("--assert-hota-halberdier-ai")) {
  assertRoster([
    "player:Champion:1:1",
    "player:Zealot:1:1",
    "player:Cavalier:1:1",
    "player:Crusader:1:1",
    "player:Griffin:4:1",
    "ai:Halberdier:22:5",
    "player:Monk:2:1",
    "player:Pikeman:1:1"
  ]);
  if (result.roundBreakIndex !== 12) throw new Error(`Unexpected round divider: ${result.roundBreakIndex}`);
}

if (process.argv.includes("--assert-ai-pikeman-reference")) {
  assertRoster([
    "player:Archangel:20:1",
    "player:Juggernaut:1:1",
    "player:Engineer:1:1",
    "player:Halfling Grenadier:1:3",
    "player:Halfling:1:1",
    "ai:Pikeman:35:1",
    "ai:Pikeman:34:1"
  ]);
  if (result.roundBreakIndex !== 9) throw new Error(`Unexpected round divider: ${result.roundBreakIndex}`);
}

function assertRoster(expected) {
  const actual = result.lowerBoundRoster
    .map(({ owner, creatureName, count, instances }) => `${owner}:${creatureName}:${count}:${instances}`)
    .sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`Unexpected roster: ${actual.join(", ")}`);
  }
}
