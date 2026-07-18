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
globalThis.window = {};
globalThis.Image = LocalImage;
globalThis.createImageBitmap = async (file) => loadImage(Buffer.from(await file.arrayBuffer()));

const [{ analyzeBattlefieldScreenshot }, { deployAllArmies }] = await Promise.all([
  import(pathToFileURL(path.join(root, "src/engine/screenshotAnalyzer.js"))),
  import(pathToFileURL(path.join(root, "src/engine/armyDeployment.js")))
]);
const simulator = JSON.parse(fs.readFileSync(path.join(root, "public/data/simulator-v1-data.json"), "utf8"));
const factory = JSON.parse(fs.readFileSync(path.join(root, "public/data/factory-creatures.json"), "utf8"));
const neutral = JSON.parse(fs.readFileSync(path.join(root, "public/data/neutral-creatures.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "public/data/battlefield-catalog.json"), "utf8"));
const detection = JSON.parse(fs.readFileSync(path.join(root, "public/assets/creatures/detection/manifest.json"), "utf8"));
const creaturesById = new Map([...(simulator.creatures || []), ...(factory.creatures || []), ...(neutral.creatures || [])]
  .map((creature) => [Number(creature.creatureId), creature]));
const data = {
  ...simulator,
  creatures: [...creaturesById.values()],
  obstacles: catalog.obstacles,
  backgrounds: catalog.backgrounds,
  creatureDetection: detection
};
const screenshotPath = path.resolve(process.argv[2]);
const bytes = fs.readFileSync(screenshotPath);
const file = new Blob([bytes], { type: "image/png" });
const result = await analyzeBattlefieldScreenshot(file, data);
if (process.argv.includes("--deploy-start")) deployAllArmies(data.battlefield.grid, result.stacks);
const includeDiagnostics = process.argv.includes("--diagnostics");
const includeObstacleDiagnostics = process.argv.includes("--obstacle-diagnostics");
const summary = {
  backgroundId: result.backgroundId,
  battleWindow: result.battleWindow,
  obstacles: result.obstacles.map(({ id, name, anchorHexId, detectedLeft, detectedTop, blockedHexIds }) => ({
    id,
    name,
    anchorHexId,
    detectedLeft,
    detectedTop,
    blockedHexIds
  })),
  ...(includeDiagnostics ? { timings: result.timings } : {}),
  ...(includeDiagnostics ? { turnRoster: result.turnRoster } : {}),
  ...((includeDiagnostics || includeObstacleDiagnostics) ? {
    obstacleDetectionDiagnostics: (result.obstacleDetectionDiagnostics || []).map((diagnostic) => ({
      definitionId: diagnostic.definitionId,
      anchorHexId: diagnostic.anchorHexId,
      x: diagnostic.x,
      y: diagnostic.y,
      correlation: diagnostic.correlation,
      gain: diagnostic.gain,
      match: diagnostic.match,
      chroma: diagnostic.chroma
    }))
  } : {}),
  ...(includeDiagnostics ? { stackDetectionDiagnostics: result.stackDetectionDiagnostics } : {}),
  stacks: result.stacks.map((stack) => ({
    creature: stack.creature.name,
    owner: stack.owner,
    count: stack.count,
    hexId: stack.hexId,
    armySlot: stack.armySlot,
    ...(includeDiagnostics ? {
      badge: stack.screenshotBadgeBounds,
      alternatives: stack.detectionAlternatives,
      countDiagnostics: stack.screenshotCountDiagnostics
    } : {})
  }))
};
if (process.argv.includes("--assert-reference")) {
  assertScene(summary, {
    backgroundId: "cmbkgrtr",
    stacks: [
      "ai:Cavalier:6@67",
      "player:Griffin:6@121",
      "player:Marksman:22@0",
      "player:Pikeman:1@60",
      "player:Pikeman:1@75",
      "player:Pikeman:1@90",
      "player:Pikeman:1@150",
      "player:Pikeman:20@30"
    ],
    obstacles: ["106@null", "22@141"]
  });
}
if (process.argv.includes("--assert-archangel-reference")) {
  assertScene(summary, {
    backgroundId: "cmbkgrmt",
    stacks: [
      "ai:Crusader:17@44",
      "ai:Crusader:17@134",
      "player:Archangel:5@1",
      "player:Archangel:5@31",
      "player:Archangel:5@61",
      "player:Archangel:5@91",
      "player:Archangel:5@121",
      "player:Archangel:5@151"
    ],
    obstacles: ["105@null", "23@62", "22@52", "21@114", "20@69"]
  });
  const slotSignature = summary.stacks
    .map(({ creature, owner, hexId, armySlot }) => `${owner}:${creature}@${hexId}#${armySlot}`)
    .sort();
  const expectedSlots = [
    "ai:Crusader@44#0",
    "ai:Crusader@134#1",
    "player:Archangel@1#0",
    "player:Archangel@31#1",
    "player:Archangel@61#2",
    "player:Archangel@91#3",
    "player:Archangel@121#4",
    "player:Archangel@151#5"
  ].sort();
  if (JSON.stringify(slotSignature) !== JSON.stringify(expectedSlots)) {
    throw new Error(`Unexpected army slots: ${slotSignature.join(", ")}`);
  }
  const stump = summary.obstacles.find(({ id }) => id === 21);
  if (!stump || Math.abs(stump.detectedLeft - 453) > 3 || Math.abs(stump.detectedTop - 380) > 3) {
    throw new Error(`Unexpected stump placement: ${stump?.detectedLeft}, ${stump?.detectedTop}`);
  }
}
if (process.argv.includes("--assert-champion-reference")) {
  assertScene(summary, {
    backgroundId: "cmbkgrmt",
    stacks: [
      "ai:Champion:15@88",
      "player:Archangel:5@1",
      "player:Archangel:5@31",
      "player:Archangel:5@61",
      "player:Archangel:5@91",
      "player:Archangel:5@121",
      "player:Archangel:5@151"
    ],
    obstacles: ["106@null"]
  });
  assertArmySlots(summary, [
    "ai:Champion@88#0",
    "player:Archangel@1#0",
    "player:Archangel@31#1",
    "player:Archangel@61#2",
    "player:Archangel@91#3",
    "player:Archangel@121#4",
    "player:Archangel@151#5"
  ]);
}
if (process.argv.includes("--assert-desert-reference")) {
  assertScene(summary, {
    backgroundId: "cmbkdes",
    stacks: [
      "ai:Angel:26@89",
      "player:Archangel:5@1",
      "player:Archangel:5@31",
      "player:Archangel:5@61",
      "player:Archangel:5@91",
      "player:Archangel:5@121",
      "player:Archangel:5@151"
    ],
    obstacles: ["1@110", "16@106", "18@67"]
  });
  assertArmySlots(summary, [
    "ai:Angel@89#0",
    "player:Archangel@1#0",
    "player:Archangel@31#1",
    "player:Archangel@61#2",
    "player:Archangel@91#3",
    "player:Archangel@121#4",
    "player:Archangel@151#5"
  ]);
  assertObstaclePlacement(summary, 16, 125, 296, 3);
  assertObstaclePlacement(summary, 1, 278, 338, 3);
  assertObstaclePlacement(summary, 18, 387, 212, 3);
}
if (process.argv.includes("--assert-hota-halberdier-mixed")) {
  const halberdier = summary.stacks.find(({ creature, owner, count, hexId }) => (
    creature === "Halberdier" && owner === "player" && count === 1 && hexId === 90
  ));
  const wrongPikeman = summary.stacks.find(({ creature, owner, count, hexId }) => (
    creature === "Pikeman" && owner === "player" && count === 1 && hexId === 90
  ));
  if (!halberdier || wrongPikeman) {
    throw new Error("The HotA Halberdier at player hex 90 was not classified correctly.");
  }
}
if (process.argv.includes("--assert-hota-halberdier-ai")) {
  const actual = summary.stacks
    .filter(({ owner, count }) => owner === "ai" && count === 22)
    .map(({ creature, hexId }) => `${creature}@${hexId}`)
    .sort();
  const expected = [14, 44, 89, 134, 164].map((hexId) => `Halberdier@${hexId}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected HotA Halberdier stacks: ${actual.join(", ")}`);
  }
}
if (process.argv.includes("--assert-complete-wasteland-roster")) {
  assertScene(summary, {
    backgroundId: "wasteland_rocks",
    stacks: [
      "player:Halfling:1@0",
      "player:Sandworm:1@31",
      "player:Automaton:1@61",
      "player:Juggernaut:1@76",
      "player:Sentinel Automaton:1@91",
      "player:Olgoi-Khorkhoi:1@121",
      "player:Halfling Grenadier:1@150",
      "ai:Royal Griffin:7@13",
      "ai:Royal Griffin:7@43",
      "ai:Royal Griffin:7@73",
      "ai:Royal Griffin:7@88",
      "ai:Royal Griffin:7@103",
      "ai:Royal Griffin:7@133",
      "ai:Royal Griffin:6@163"
    ],
    obstacles: ["212@null", "209@82", "201@101", "200@121"]
  });
  // These coordinates come from the real HotA screenshot, not from a
  // synthetic scene generated with the same metadata as the renderer.
  assertObstaclePlacement(summary, 201, 564, 212, 2);
  assertObstaclePlacement(summary, 209, 366, 212, 2);
  assertObstaclePlacement(summary, 200, 124, 338, 2);
}
if (process.argv.includes("--assert-full-window-crop")) {
  const bounds = summary.battleWindow;
  if (!bounds.detected || bounds.x !== 472 || bounds.y !== 73 || bounds.width !== 1615 || bounds.height !== 1288) {
    throw new Error(`Unexpected full-screen battle-window crop: ${JSON.stringify(bounds)}`);
  }
}
if (process.argv.includes("--assert-partial-wasteland-roster")) {
  assertScene(summary, {
    backgroundId: "wasteland_rocks",
    stacks: [
      "player:Halfling:1@0",
      "player:Sandworm:1@31",
      "player:Automaton:1@61",
      "player:Juggernaut:1@76",
      "player:Sentinel Automaton:1@91",
      "player:Olgoi-Khorkhoi:1@121",
      "player:Halfling Grenadier:1@150",
      "ai:Sandworm:2@13",
      "ai:Sandworm:2@43",
      "ai:Olgoi-Khorkhoi:2@88",
      "ai:Sandworm:2@133",
      "ai:Sandworm:1@163"
    ],
    obstacles: ["209@63", "205@46", "207@108", "202@77", "201@144"]
  });
  assertObstaclePlacement(summary, 209, 212, 170, 2);
  assertObstaclePlacement(summary, 205, 102, 128, 2);
  assertObstaclePlacement(summary, 207, 190, 254, 2);
  assertObstaclePlacement(summary, 202, 146, 254, 2);
  assertObstaclePlacement(summary, 201, 454, 338, 2);
}
console.log(JSON.stringify(summary, null, 2));

function assertScene(actual, expectedScene) {
  const signature = actual.stacks.map(({ creature, owner, count, hexId }) => `${owner}:${creature}:${count}@${hexId}`).sort();
  const expected = [...expectedScene.stacks].sort();
  if (JSON.stringify(signature) !== JSON.stringify(expected)) throw new Error(`Unexpected stack signature: ${signature.join(", ")}`);
  if (actual.backgroundId !== expectedScene.backgroundId) throw new Error(`Unexpected background: ${actual.backgroundId}`);
  const obstacleSignature = actual.obstacles.map(({ id, anchorHexId }) => `${id}@${anchorHexId}`).sort();
  if (JSON.stringify(obstacleSignature) !== JSON.stringify([...expectedScene.obstacles].sort())) {
    throw new Error(`Unexpected obstacles: ${obstacleSignature.join(", ")}`);
  }
}

function assertArmySlots(actual, expectedSlots) {
  const slots = actual.stacks
    .map(({ creature, owner, hexId, armySlot }) => `${owner}:${creature}@${hexId}#${armySlot}`)
    .sort();
  const expected = [...expectedSlots].sort();
  if (JSON.stringify(slots) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected army slots: ${slots.join(", ")}`);
  }
}

function assertObstaclePlacement(actual, id, expectedLeft, expectedTop, tolerance) {
  const obstacle = actual.obstacles.find((candidate) => candidate.id === id);
  if (!obstacle
      || Math.abs(obstacle.detectedLeft - expectedLeft) > tolerance
      || Math.abs(obstacle.detectedTop - expectedTop) > tolerance) {
    throw new Error(`Unexpected obstacle ${id} placement: ${obstacle?.detectedLeft}, ${obstacle?.detectedTop}`);
  }
}
