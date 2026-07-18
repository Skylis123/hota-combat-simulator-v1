import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { templateEmbeddingRatio } from "../src/engine/templateOverlap.js";

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

const topBoundaryAudit = process.argv.includes("--top-boundary");
const requestedIds = new Set(process.argv.slice(2).filter((value) => /^\d+$/.test(value)).map(Number));
const definitions = requestedIds.size
  ? catalog.obstacles.filter((obstacle) => requestedIds.has(obstacle.id))
  : catalog.obstacles.filter((obstacle) => !topBoundaryAudit || !obstacle.absolute);
const auditCases = definitions.flatMap((definition) => (
  selectTerrains(definition).map((terrain) => ({ definition, terrain }))
));
const failures = [];
const terrainCounts = new Map();
const obstacleImageBuffers = new Map();
const obstaclePixelBuffers = new WeakMap();

for (const { definition, terrain } of auditCases) {
  const label = `${definition.id} ${definition.name} [${terrain}]`;
  const background = catalog.backgrounds.find((candidate) => candidate.id === backgroundByTerrain[terrain]);
  if (!background) {
    failures.push(`${label}: no audit background`);
    continue;
  }
  const anchorHexId = definition.absolute ? null : selectAnchor(definition);
  if (!definition.absolute && anchorHexId === null) {
    failures.push(`${label}: no legal ${topBoundaryAudit ? "top-boundary" : "central"} anchor`);
    continue;
  }
  const obstacle = { ...definition, anchorHexId };
  // Ground truth is intentionally calculated here from the documented native
  // constants instead of calling the production placement function. This
  // makes the audit fail when detector and renderer drift together.
  const expectedPosition = independentObstaclePosition(simulator.battlefield.grid, obstacle);
  const expectedBlocked = independentBlockedHexes(simulator.battlefield.grid, obstacle, anchorHexId);
  const detectedBlocked = obstacleEngine.detectedObstacleBlockedHexes(simulator.battlefield.grid, obstacle, anchorHexId);
  if (signature(detectedBlocked) !== signature(expectedBlocked)) {
    failures.push(`${label}: imported blocked tiles differ from engine blocked tiles`);
    continue;
  }

  const backgroundImage = await loadImage(path.join(root, "public", background.image));
  const obstacleImage = await loadImage(path.join(root, "public", definition.image));
  const canvas = createCanvas(800, 556);
  const context = canvas.getContext("2d");
  context.drawImage(backgroundImage, 0, 0, 800, 556);
  context.drawImage(obstacleImage, expectedPosition.left, expectedPosition.top);
  drawNativeShadeAndGrid(context, simulator.battlefield.grid);
  const file = new Blob([canvas.encodeSync("png")], { type: "image/png" });
  const compatibleDefinitions = catalog.obstacles.filter((candidate) => isCompatible(candidate, terrain));
  const result = await analyzeBattlefieldScreenshot(file, {
    ...simulator,
    creatures: [],
    // All compatible definitions compete, matching the real Import path.
    obstacles: compatibleDefinitions,
    backgrounds: catalog.backgrounds,
    creatureDetection: { ...detection, creatures: {} }
  });
  const imported = result.obstacles.find((candidate) => candidate.id === definition.id)
    || result.obstacles.find((candidate) => equivalentObstacleDefinition(candidate, definition));
  if (!imported) {
    const diagnostic = result.obstacleDetectionDiagnostics?.find((candidate) => candidate.definitionId === definition.id);
    const absoluteScores = result.obstacleDetectionDiagnostics
      ?.filter((candidate) => candidate.anchorHexId === null)
      .map((candidate) => ({ id: candidate.definitionId, correlation: candidate.correlation, gain: candidate.gain, match: candidate.match, chroma: candidate.chroma }));
    failures.push(`${label}: Import identified ${result.backgroundId} and did not detect the synthetic exact placement; imported [${result.obstacles.map((candidate) => candidate.id).join(", ")}]${diagnostic ? ` (${JSON.stringify({ anchorHexId: diagnostic.anchorHexId, correlation: diagnostic.correlation, gain: diagnostic.gain, match: diagnostic.match, chroma: diagnostic.chroma, anchorDistance: diagnostic.anchorDistance })})` : ""}${absoluteScores?.length ? `; absolute scores ${JSON.stringify(absoluteScores)}` : ""}`);
    continue;
  }
  if (result.obstacles.length !== 1) {
    const sourceTemplate = imageTemplateRecord(obstacleImage, expectedPosition.left, expectedPosition.top);
    const placements = await Promise.all(result.obstacles.map(async (candidate) => {
      const candidateImage = await loadImage(path.join(root, "public", candidate.image));
      return {
        id: candidate.id,
        anchorHexId: candidate.anchorHexId,
        blockedHexIds: candidate.blockedHexIds,
        left: candidate.detectedLeft,
        top: candidate.detectedTop,
        confidence: candidate.detectionConfidence,
        embeddingRatio: templateEmbeddingRatio(
          imageTemplateRecord(candidateImage, candidate.detectedLeft, candidate.detectedTop),
          sourceTemplate
        )
      };
    }));
    failures.push(`${label}: Import produced ${result.obstacles.length} instances for one source obstacle ${JSON.stringify(placements)}`);
    continue;
  }
  const renderedPosition = obstacleEngine.obstacleRenderPosition(simulator.battlefield.grid, imported);
  const positionError = Math.max(
    Math.abs(renderedPosition.left - expectedPosition.left),
    Math.abs(renderedPosition.top - expectedPosition.top)
  );
  if (positionError > 2) failures.push(`${label}: ${positionError}px placement error`);
  if (imported.anchorHexId !== anchorHexId) {
    failures.push(`${label}: anchor ${imported.anchorHexId}, expected ${anchorHexId}`);
  }
  if (signature(imported.blockedHexIds) !== signature(expectedBlocked)) {
    failures.push(`${label}: imported footprint ${signature(imported.blockedHexIds)}, expected ${signature(expectedBlocked)}`);
  }
  terrainCounts.set(terrain, (terrainCounts.get(terrain) || 0) + 1);
  process.stdout.write(`\rAudited ${[...terrainCounts.values()].reduce((sum, value) => sum + value, 0)}/${auditCases.length} obstacle/battlefield combinations`);
}

process.stdout.write("\n");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Obstacle Import ${topBoundaryAudit ? "top-boundary " : ""}audit passed: ${definitions.length} definitions, ${auditCases.length} combinations across ${terrainCounts.size} battlefield categories.`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function selectTerrains(definition) {
  const candidates = [definition.category, ...(definition.allowedTerrains || []), ...(definition.specialBattlefields || [])];
  return [...new Set(candidates.filter((terrain) => backgroundByTerrain[terrain]))];
}

function selectAnchor(definition) {
  const grid = simulator.battlefield.grid;
  return grid.hexes
    .filter((hex) => (!topBoundaryAudit || hex.row === definition.height)
      && obstacleEngine.canPlaceObstacle(grid, { stacks: [], obstacles: [] }, definition, hex.id))
    .sort((left, right) => (
      Math.hypot(left.centerX - 400, left.centerY - 310) - Math.hypot(right.centerX - 400, right.centerY - 310)
    ))[0]?.id ?? null;
}

function signature(values) {
  return [...(values || [])].sort((left, right) => left - right).join(",");
}

function equivalentObstacleDefinition(left, right) {
  if (Boolean(left?.absolute) !== Boolean(right?.absolute)) return false;
  if (signature(left?.blockedTiles) !== signature(right?.blockedTiles)) return false;
  for (const key of ["placementOffsetX", "placementOffsetY", "imageWidth", "imageHeight"]) {
    if (left?.[key] == null && right?.[key] == null) continue;
    if (Number(left?.[key]) !== Number(right?.[key])) return false;
  }
  const imageBuffer = (definition) => {
    if (!obstacleImageBuffers.has(definition.image)) {
      obstacleImageBuffers.set(definition.image, fs.readFileSync(path.join(root, "public", definition.image)));
    }
    return obstacleImageBuffers.get(definition.image);
  };
  return imageBuffer(left).equals(imageBuffer(right));
}

function imageTemplateRecord(image, left, top) {
  if (!obstaclePixelBuffers.has(image)) {
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    obstaclePixelBuffers.set(image, context.getImageData(0, 0, image.width, image.height).data);
  }
  return {
    pixels: obstaclePixelBuffers.get(image),
    width: image.width,
    height: image.height,
    left,
    top
  };
}

function independentObstaclePosition(grid, obstacle) {
  if (obstacle.absolute) {
    return {
      left: obstacle.placementOffsetX ?? obstacle.width,
      top: obstacle.placementOffsetY ?? obstacle.height
    };
  }
  const anchor = grid.hexes.find((hex) => hex.id === obstacle.anchorHexId);
  if (!anchor) throw new Error(`Missing audit anchor ${obstacle.anchorHexId}`);
  const engineCol = anchor.engineId % 17;
  const rectLeft = 14 + (anchor.row % 2 === 0 ? 22 : 0) + 44 * engineCol;
  const rectTop = 86 + 42 * anchor.row;
  const explicitOffset = Number(obstacle.renderYOffset);
  const renderYOffset = Number.isFinite(explicitOffset) && explicitOffset > 0
    ? explicitOffset
    : 42 * Number(obstacle.height || 0) + 10;
  return { left: rectLeft, top: rectTop + 52 - renderYOffset };
}

function independentBlockedHexes(grid, obstacle, anchorHexId) {
  if (obstacle.absolute) {
    return obstacle.blockedTiles
      .map((engineId) => grid.hexes.find((hex) => hex.engineId === engineId)?.id)
      .filter(Number.isInteger);
  }
  const anchor = grid.hexes.find((hex) => hex.id === anchorHexId);
  return obstacle.blockedTiles.map((offset) => {
    let engineId = anchor.engineId + offset;
    const targetRow = Math.floor(engineId / 17);
    if (anchor.row % 2 === 1 && targetRow % 2 === 0) engineId -= 1;
    return grid.hexes.find((hex) => hex.engineId === engineId)?.id;
  }).filter(Number.isInteger);
}

function drawNativeShadeAndGrid(context, grid) {
  // In the game, reachability shade and CCELLGRD are drawn after normal
  // obstacles. Exercise that compositing order rather than testing clean PNG
  // pasted over a clean background.
  for (const hex of grid.hexes) {
    const points = hex.polygonPoints;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => context.lineTo(x, y));
    context.closePath();
    if (hex.col <= 7) {
      context.fillStyle = "rgba(31, 22, 10, 0.42)";
      context.fill();
    }
    context.strokeStyle = "rgba(218, 190, 83, 0.78)";
    context.lineWidth = 1;
    context.stroke();
  }
}

function isCompatible(definition, terrain) {
  return definition.category === terrain
    || (definition.allowedTerrains || []).includes(terrain)
    || (definition.specialBattlefields || []).includes(terrain);
}
