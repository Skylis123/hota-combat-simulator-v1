import { footprintHexes } from "./footprint.js";

const ORIGINAL_COLS = 17;
const VISIBLE_COL_OFFSET = 1;
const USUAL_OBSTACLE_MIN_VISIBLE_COL = 2;
const USUAL_OBSTACLE_MAX_VISIBLE_COL = 12;

export function obstacleBlockedHexes(grid, obstacle, anchorHexId = obstacle?.anchorHexId) {
  if (!obstacle) return [];
  if (obstacle.absolute) {
    return obstacle.blockedTiles.map((index) => originalIndexToVisibleHex(grid, index)).filter((id) => id !== null);
  }
  const anchor = grid.hexes.find((hex) => hex.id === anchorHexId);
  if (!anchor) return [];
  const originalAnchor = Number.isFinite(anchor.engineId) ? anchor.engineId : anchor.row * ORIGINAL_COLS + anchor.col + VISIBLE_COL_OFFSET;
  return obstacle.blockedTiles.map((offset) => {
    let originalIndex = originalAnchor + offset;
    const targetRow = Math.floor(originalIndex / ORIGINAL_COLS);
    if (anchor.row % 2 === 1 && targetRow % 2 === 0) originalIndex -= 1;
    return originalIndexToVisibleHex(grid, originalIndex);
  }).filter((id) => id !== null);
}

export function allObstacleBlockedHexes(state) {
  return new Set((state.obstacles || []).flatMap((obstacle) => obstacle.blockedHexIds || []));
}

export function canPlaceObstacle(grid, state, definition, anchorHexId = null) {
  const blockedHexIds = obstacleBlockedHexes(grid, definition, anchorHexId);
  if (!blockedHexIds.length || blockedHexIds.length !== definition.blockedTiles.length) return false;
  if (!definition.absolute) {
    const anchor = grid.hexes.find((hex) => hex.id === anchorHexId);
    if (!isValidUsualObstacleAnchor(anchor, definition)) return false;
    if (!blockedHexIds.every((hexId) => {
      const hex = grid.hexes.find((candidate) => candidate.id === hexId);
      return hex
        && hex.col >= USUAL_OBSTACLE_MIN_VISIBLE_COL
        && hex.col <= USUAL_OBSTACLE_MAX_VISIBLE_COL;
    })) return false;
  }
  const occupied = new Set();
  for (const stack of state.stacks || []) {
    if (stack.alive === false) continue;
    for (const hexId of footprintHexes(grid, stack) || []) occupied.add(hexId);
  }
  for (const obstacle of state.obstacles || []) {
    for (const hexId of obstacle.blockedHexIds || []) occupied.add(hexId);
  }
  return blockedHexIds.every((hexId) => !occupied.has(hexId));
}

export function createObstacleInstance(grid, definition, anchorHexId = null) {
  return {
    ...definition,
    instanceId: `obstacle_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    anchorHexId,
    blockedHexIds: obstacleBlockedHexes(grid, definition, anchorHexId)
  };
}

export function obstacleRenderPosition(grid, obstacle) {
  if (obstacle?.absolute) {
    if (Number.isFinite(obstacle.detectedLeft) && Number.isFinite(obstacle.detectedTop)) {
      return { left: obstacle.detectedLeft, top: obstacle.detectedTop };
    }
    return { left: obstacle.width, top: obstacle.height };
  }

  const blockedHexIds = obstacle?.blockedHexIds?.length
    ? obstacle.blockedHexIds
    : obstacleBlockedHexes(grid, obstacle, obstacle?.anchorHexId);
  const occupiedHexes = blockedHexIds
    .map((hexId) => grid.hexes.find((hex) => hex.id === hexId))
    .filter(Boolean);
  if (!occupiedHexes.length) return null;

  const centerX = occupiedHexes.reduce((sum, hex) => sum + hex.centerX, 0) / occupiedHexes.length;
  const centerY = occupiedHexes.reduce((sum, hex) => sum + hex.centerY, 0) / occupiedHexes.length;
  const imageWidth = Number.isFinite(obstacle.imageWidth) ? obstacle.imageWidth : 0;
  const imageHeight = Number.isFinite(obstacle.imageHeight) ? obstacle.imageHeight : 0;
  const artOffsetX = Number.isFinite(obstacle.artOffsetX) ? obstacle.artOffsetX : 0;
  const artOffsetY = Number.isFinite(obstacle.artOffsetY) ? obstacle.artOffsetY : 0;
  return {
    left: centerX - imageWidth / 2 + artOffsetX,
    top: centerY - imageHeight / 2 + artOffsetY
  };
}

export function generateObstacleLayout(grid, state, definitions, category, rng = Math.random) {
  const compatible = definitions.filter((obstacle) => obstacle.category === category || obstacle.allowedTerrains.includes(category) || obstacle.specialBattlefields.includes(category));
  const absolute = compatible.filter((obstacle) => obstacle.absolute);
  const usual = compatible.filter((obstacle) => !obstacle.absolute);
  const generated = [];
  const draft = { ...state, obstacles: generated };
  let tilesToBlock = 5 + Math.floor(rng() * 8);
  if (absolute.length && rng() <= 0.4) {
    const definition = absolute[Math.floor(rng() * absolute.length)];
    if (canPlaceObstacle(grid, draft, definition)) {
      const instance = createObstacleInstance(grid, definition);
      generated.push(instance);
      tilesToBlock -= Math.floor(instance.blockedHexIds.length / 2);
    }
  }
  let attempts = 0;
  while (tilesToBlock > 0 && usual.length && attempts++ < 500) {
    const definition = usual[Math.floor(rng() * usual.length)];
    const anchors = grid.hexes.filter((hex) => isValidUsualObstacleAnchor(hex, definition));
    if (!anchors.length) continue;
    const anchor = anchors[Math.floor(rng() * anchors.length)];
    if (!canPlaceObstacle(grid, draft, definition, anchor.id)) continue;
    const instance = createObstacleInstance(grid, definition, anchor.id);
    generated.push(instance);
    tilesToBlock -= instance.blockedHexIds.length;
  }
  return generated;
}

function isValidUsualObstacleAnchor(anchor, definition) {
  if (!anchor) return false;
  const height = definitionHeight(definition);
  const width = Number.isFinite(definition?.width) ? definition.width : 0;
  const originalCol = Number.isFinite(anchor.engineId)
    ? anchor.engineId % ORIGINAL_COLS
    : anchor.col + VISIBLE_COL_OFFSET;
  return anchor.row > height && originalCol !== 0 && originalCol + width <= 15;
}

function definitionHeight(definition) {
  return Number.isFinite(definition?.height) ? definition.height : 0;
}

function originalIndexToVisibleHex(grid, originalIndex) {
  const engineMapped = grid.hexes.find((hex) => hex.engineId === originalIndex);
  if (engineMapped) return engineMapped.id;
  const row = Math.floor(originalIndex / ORIGINAL_COLS);
  const originalCol = originalIndex % ORIGINAL_COLS;
  const col = originalCol - VISIBLE_COL_OFFSET;
  return grid.hexes.find((hex) => hex.row === row && hex.col === col)?.id ?? null;
}
