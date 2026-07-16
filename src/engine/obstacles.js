import { footprintHexes } from "./footprint.js";

const ORIGINAL_COLS = 17;
const VISIBLE_COL_OFFSET = 1;
const USUAL_OBSTACLE_MIN_VISIBLE_COL = 2;
const USUAL_OBSTACLE_MAX_VISIBLE_COL = 12;
const HEX_ROW_STEP = 42;
const OBSTACLE_Y_OFFSET = 10;

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

// Imported obstacles use the exact same `pos + blockedTiles` contract as the
// game. Negative offsets are intentional: tall graphics are anchored at their
// bottom-left battlefield hex while the blocking footprint may sit one or more
// rows above that anchor. Moving that footprint independently makes the sprite
// and the movement grid disagree.
export function detectedObstacleBlockedHexes(grid, obstacle, anchorHexId = obstacle?.anchorHexId) {
  return obstacleBlockedHexes(grid, obstacle, anchorHexId);
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
    // Fixed battlefield graphics have no grid anchor, so their detected pixel
    // position is authoritative. Usual obstacles below are deliberately
    // snapped to their canonical anchor instead of retaining sub-hex image
    // matching drift from the source screenshot.
    if (Number.isFinite(obstacle.detectedLeft) && Number.isFinite(obstacle.detectedTop)) {
      return { left: obstacle.detectedLeft, top: obstacle.detectedTop };
    }
    return { left: obstacle.width, top: obstacle.height };
  }
  // An imported obstacle has already been matched against the normalized
  // native battlefield. Preserve that exact position: snapping it a second
  // time can move a wide DEF frame onto the neighbouring visual hex.
  if (Number.isFinite(obstacle?.detectedLeft) && Number.isFinite(obstacle?.detectedTop)) {
    return { left: obstacle.detectedLeft, top: obstacle.detectedTop };
  }
  const nativePosition = obstacleNativePosition(grid, obstacle);
  if (!nativePosition) return null;
  const anchor = grid.hexes.find((hex) => hex.id === obstacle?.anchorHexId);
  if (!anchor || !Number.isFinite(obstacle.imageWidth)) return nativePosition;
  return {
    // Manual placement is a direct click contract: the image frame is
    // centred on the hex the user clicked. Centering it on the average of
    // `blockedTiles` shifts many Wasteland graphics (especially cacti and
    // rocks with row-relative footprints) almost one whole hex to the right.
    left: anchor.centerX - obstacle.imageWidth / 2,
    top: nativePosition.top
  };
}

// Heroes III/VCMI positions usual obstacle frames from the bottom-left of
// their logical `pos` hex. Screenshot matching must use this native contract;
// the interactive renderer above additionally centres a manually selected
// frame over the hexes it actually blocks.
export function obstacleNativePosition(grid, obstacle) {
  if (obstacle?.absolute) return obstacleRenderPosition(grid, obstacle);
  const anchor = grid.hexes.find((hex) => hex.id === obstacle?.anchorHexId);
  if (!anchor) return null;
  const polygonX = anchor.polygonPoints?.map(([x]) => x) || [];
  const polygonY = anchor.polygonPoints?.map(([, y]) => y) || [];
  const bottomLeftX = polygonX.length ? Math.min(...polygonX) : anchor.centerX - 22;
  const bottomY = polygonY.length ? Math.max(...polygonY) : anchor.centerY + 28;
  return {
    left: bottomLeftX,
    top: bottomY - (HEX_ROW_STEP * definitionHeight(obstacle) + OBSTACLE_Y_OFFSET)
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
