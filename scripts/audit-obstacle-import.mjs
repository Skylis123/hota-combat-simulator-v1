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

const [{ analyzeBattlefieldScreenshot }, obstacleEngine] = await Promise.all([
  import(pathToFileURL(path.join(root, "src/engine/screenshotAnalyzer.js"))),
  import(pathToFileURL(path.join(root, "src/engine/obstacles.js")))
]);
const simulator = readJson("public/data/simulator-v1-data.json");
const catalog = readJson("public/data/battlefield-catalog.json");
const detection = readJson("public/assets/creatures/detection/manifest.json");
const backgroundByTerrain = {
  dirt: "cmbkdrtr", sand: "cmbkdes", grass: "cmbkgrtr", snow: "cmbksntr",
  swamp: "cmbkswmp", rough: "cmbkrgh", subterra: "cmbksub", lava: "cmbklava",
  sand_shore: "cmbkbch", cursed_ground: "cmbkcur", evil_fog: "cmbkef",
  fiery_fields: "cmbkff", holy_ground: "cmbkhg", lucid_pools: "cmbklp",
  magic_plains: "cmbkmag", magic_clouds: "cmbkmc", rocklands: "cmbkrk",
  clover_field: "cmbkcf", ship: "cmbkboat", wasteland: "wasteland_rocks"
};

const requestedIds = new Set(process.argv.slice(2).filter((value) => /^\d+$/.test(value)).map(Number));
const definitions = requestedIds.size
  ? catalog.obstacles.filter((obstacle) => requestedIds.has(obstacle.id))
  : catalog.obstacles;
const failures = [];
const terrainCounts = new Map();

for (const definition of definitions) {
  const terrain = selectTerrain(definition);
  const background = catalog.backgrounds.find((candidate) => candidate.id === backgroundByTerrain[terrain]);
  if (!background) {
    failures.push(`${definition.id} ${definition.name}: no audit background for ${terrain}`);
    continue;
  }
  const anchorHexId = definition.absolute ? null : selectAnchor(definition);
  if (!definition.absolute && anchorHexId === null) {
    failures.push(`${definition.id} ${definition.name}: no legal central anchor`);
    continue;
  }
  const obstacle = { ...definition, anchorHexId };
  const expectedPosition = obstacleEngine.obstacleRenderPosition(simulator.battlefield.grid, obstacle);
  const expectedBlocked = obstacleEngine.obstacleBlockedHexes(simulator.battlefield.grid, obstacle, anchorHexId);
  const detectedBlocked = obstacleEngine.detectedObstacleBlockedHexes(simulator.battlefield.grid, obstacle, anchorHexId);
  if (signature(detectedBlocked) !== signature(expectedBlocked)) {
    failures.push(`${definition.id} ${definition.name}: imported blocked tiles differ from engine blocked tiles`);
    continue;
  }

  const backgroundImage = await loadImage(path.join(root, "public", background.image));
  const obstacleImage = await loadImage(path.join(root, "public", definition.image));
  const canvas = createCanvas(800, 556);
  const context = canvas.getContext("2d");
  context.drawImage(backgroundImage, 0, 0, 800, 556);
  context.drawImage(obstacleImage, expectedPosition.left, expectedPosition.top);
  const file = new Blob([canvas.encodeSync("png")], { type: "image/png" });
  const result = await analyzeBattlefieldScreenshot(file, {
    ...simulator,
    creatures: [],
    obstacles: [definition],
    backgrounds: catalog.backgrounds,
    creatureDetection: { ...detection, creatures: {} }
  });
  const imported = result.obstacles.find((candidate) => candidate.id === definition.id);
  if (!imported) {
    failures.push(`${definition.id} ${definition.name}: Import did not detect the synthetic exact placement`);
    continue;
  }
  if (result.obstacles.length !== 1) {
    failures.push(`${definition.id} ${definition.name}: Import produced ${result.obstacles.length} instances for one source obstacle`);
    continue;
  }
  const positionError = Math.max(
    Math.abs(imported.detectedLeft - expectedPosition.left),
    Math.abs(imported.detectedTop - expectedPosition.top)
  );
  if (positionError > 2) failures.push(`${definition.id} ${definition.name}: ${positionError}px placement error`);
  if (imported.anchorHexId !== anchorHexId) {
    failures.push(`${definition.id} ${definition.name}: anchor ${imported.anchorHexId}, expected ${anchorHexId}`);
  }
  if (signature(imported.blockedHexIds) !== signature(expectedBlocked)) {
    failures.push(`${definition.id} ${definition.name}: imported footprint ${signature(imported.blockedHexIds)}, expected ${signature(expectedBlocked)}`);
  }
  terrainCounts.set(terrain, (terrainCounts.get(terrain) || 0) + 1);
  process.stdout.write(`\rAudited ${[...terrainCounts.values()].reduce((sum, value) => sum + value, 0)}/${definitions.length} obstacles`);
}

process.stdout.write("\n");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Obstacle Import audit passed: ${definitions.length} definitions across ${terrainCounts.size} battlefield categories.`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function selectTerrain(definition) {
  const candidates = [definition.category, ...(definition.allowedTerrains || []), ...(definition.specialBattlefields || [])];
  return candidates.find((terrain) => backgroundByTerrain[terrain]) || candidates[0];
}

function selectAnchor(definition) {
  const grid = simulator.battlefield.grid;
  return grid.hexes
    .filter((hex) => obstacleEngine.canPlaceObstacle(grid, { stacks: [], obstacles: [] }, definition, hex.id))
    .sort((left, right) => (
      Math.hypot(left.centerX - 400, left.centerY - 310) - Math.hypot(right.centerX - 400, right.centerY - 310)
    ))[0]?.id ?? null;
}

function signature(values) {
  return [...(values || [])].sort((left, right) => left - right).join(",");
}
