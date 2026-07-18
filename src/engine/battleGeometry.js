// Canonical Heroes III / VCMI battlefield geometry at 800x556.
//
// The game addresses a 17x11 engine grid. The two border columns are hidden,
// leaving the 15x11 cells exposed by the simulator. CCELLSHD/CCELLGRD are
// 45x52 rasters; adjacent cells overlap by one horizontal pixel.
export const BATTLEFIELD_WIDTH = 800;
export const BATTLEFIELD_HEIGHT = 556;
export const BATTLEFIELD_ENGINE_COLUMNS = 17;
export const BATTLE_HEX_ORIGIN_X = 14;
export const BATTLE_HEX_ORIGIN_Y = 86;
export const BATTLE_HEX_COLUMN_STEP = 44;
export const BATTLE_HEX_ROW_STEP = 42;
export const BATTLE_HEX_RASTER_WIDTH = 45;
export const BATTLE_HEX_RASTER_HEIGHT = 52;
export const BATTLE_HEX_EVEN_ROW_OFFSET_X = 22;
export const USUAL_OBSTACLE_BASE_OFFSET_Y = 10;

export function engineColumnForHex(hex) {
  if (Number.isFinite(Number(hex?.engineId))) {
    return Number(hex.engineId) % BATTLEFIELD_ENGINE_COLUMNS;
  }
  return Number(hex?.col ?? 0) + 1;
}

export function nativeBattleHexRect(hex) {
  const row = Number(hex?.row);
  if (!Number.isInteger(row)) return null;
  const engineCol = engineColumnForHex(hex);
  if (!Number.isInteger(engineCol)) return null;
  return {
    left: BATTLE_HEX_ORIGIN_X
      + (row % 2 === 0 ? BATTLE_HEX_EVEN_ROW_OFFSET_X : 0)
      + BATTLE_HEX_COLUMN_STEP * engineCol,
    top: BATTLE_HEX_ORIGIN_Y + BATTLE_HEX_ROW_STEP * row,
    width: BATTLE_HEX_RASTER_WIDTH,
    height: BATTLE_HEX_RASTER_HEIGHT
  };
}

export function nativeBattleHexGeometry(hex) {
  const rect = nativeBattleHexRect(hex);
  if (!rect) return null;
  const centerX = rect.left + 22;
  const centerY = rect.top + 26;
  return {
    centerX,
    centerY,
    // This is the opaque outline of the native 45x52 cell raster, expressed
    // as a polygon for SVG rendering and pointer hit-testing.
    polygonPoints: [
      [rect.left, rect.top + 10],
      [centerX, rect.top],
      [rect.left + 44, rect.top + 10],
      [rect.left + 44, rect.top + 41],
      [centerX, rect.top + 51],
      [rect.left, rect.top + 41]
    ]
  };
}

export function usualObstacleRenderYOffset(obstacleHeight, renderYOffset = null) {
  const explicitOffset = Number(renderYOffset);
  if (Number.isFinite(explicitOffset) && explicitOffset > 0) return explicitOffset;
  const height = Number.isFinite(Number(obstacleHeight)) ? Number(obstacleHeight) : 0;
  return BATTLE_HEX_ROW_STEP * height + USUAL_OBSTACLE_BASE_OFFSET_Y;
}

export function nativeUsualObstaclePosition(hex, obstacleHeight, renderYOffset = null) {
  const rect = nativeBattleHexRect(hex);
  if (!rect) return null;
  const offsetY = usualObstacleRenderYOffset(obstacleHeight, renderYOffset);
  return {
    left: rect.left,
    top: rect.top + rect.height - offsetY
  };
}
