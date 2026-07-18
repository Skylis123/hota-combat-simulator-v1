import { footprintHexes } from "./footprint.js";
import { BATTLEFIELD_ENGINE_COLUMNS, nativeUsualObstaclePosition } from "./battleGeometry.js";

const ORIGINAL_COLS = BATTLEFIELD_ENGINE_COLUMNS;
const VISIBLE_COL_OFFSET = 1;
const USUAL_OBSTACLE_MIN_VISIBLE_COL = 2;
const CLASSIC_USUAL_OBSTACLE_MAX_VISIBLE_COL = 12;
const WASTELAND_USUAL_OBSTACLE_MAX_VISIBLE_COL = 13;

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
    const maxVisibleCol = isWastelandObstacle(definition)
      ? WASTELAND_USUAL_OBSTACLE_MAX_VISIBLE_COL
      : CLASSIC_USUAL_OBSTACLE_MAX_VISIBLE_COL;
    if (!blockedHexIds.every((hexId) => {
      const hex = grid.hexes.find((candidate) => candidate.id === hexId);
      return hex
        && hex.col >= USUAL_OBSTACLE_MIN_VISIBLE_COL
        && hex.col <= maxVisibleCol;
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
    // Fixed battlefield graphics have fixed catalog coordinates and fixed
    // engine cells. Matcher refinement is evidence for selecting the asset,
    // not a second render position that may drift away from those cells.
    return {
      left: Number.isFinite(obstacle.placementOffsetX) ? obstacle.placementOffsetX : obstacle.width,
      top: Number.isFinite(obstacle.placementOffsetY) ? obstacle.placementOffsetY : obstacle.height
    };
  }
  // Imported and manual usual obstacles share the native game contract. The
  // screenshot matcher only chooses the logical anchor; it never becomes a
  // second visual coordinate system.
  return obstacleNativePosition(grid, obstacle);
}

export function manualObstaclePlacement(grid, state, definition, clickedHexId) {
  const clickedHex = grid.hexes.find((hex) => hex.id === clickedHexId);
  if (!clickedHex || definition?.absolute) return null;
  const candidates = [];
  for (const anchor of grid.hexes) {
    if (!canPlaceObstacle(grid, state, definition, anchor.id)) continue;
    const blockedHexIds = obstacleBlockedHexes(grid, definition, anchor.id);
    if (!blockedHexIds.includes(clickedHexId)) continue;
    const blockedHexes = blockedHexIds
      .map((hexId) => grid.hexes.find((hex) => hex.id === hexId))
      .filter(Boolean);
    const centerX = blockedHexes.reduce((sum, hex) => sum + hex.centerX, 0) / blockedHexes.length;
    const centerY = blockedHexes.reduce((sum, hex) => sum + hex.centerY, 0) / blockedHexes.length;
    candidates.push({
      anchorHexId: anchor.id,
      clickedHexId,
      distance: Math.hypot(centerX - clickedHex.centerX, centerY - clickedHex.centerY)
    });
  }
  candidates.sort((left, right) => left.distance - right.distance || left.anchorHexId - right.anchorHexId);
  return candidates[0] || null;
}

// Heroes III/VCMI positions usual obstacle frames from the bottom-left of
// their logical `pos` cell raster. Shadows and transparent padding are part of
// the DEF and must not be used to recenter the image.
export function obstacleNativePosition(grid, obstacle) {
  if (obstacle?.absolute) return obstacleRenderPosition(grid, obstacle);
  const anchor = grid.hexes.find((hex) => hex.id === obstacle?.anchorHexId);
  if (!anchor) return null;
  return nativeUsualObstaclePosition(anchor, definitionHeight(obstacle), obstacle.renderYOffset);
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
  // VCMI uses a strict `pos.y > height` boundary for classic DEF obstacles.
  // HotA's Wasteland placement accepts the boundary row itself (visible in
  // real Factory captures), so keep that compatibility exception scoped to
  // this terrain instead of widening every battlefield.
  const wasteland = isWastelandObstacle(definition);
  const validRow = wasteland ? anchor.row >= height : anchor.row > height;
  return validRow && originalCol !== 0 && originalCol + width <= 15;
}

function isWastelandObstacle(definition) {
  return definition?.category === "wasteland"
    || definition?.allowedTerrains?.includes("wasteland");
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
