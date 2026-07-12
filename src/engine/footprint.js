import { inferAbilityFlags } from "./abilities.js";

export function footprintHexes(grid, stack, primaryHexId = stack?.hexId) {
  if (!stack || primaryHexId === null || primaryHexId === undefined) return null;
  const primary = grid.hexes.find((hex) => hex.id === primaryHexId);
  if (!primary) return null;
  if (!inferAbilityFlags(stack.creature || stack).twoHex) return [primaryHexId];

  const rearCol = primary.col + (stack.owner === "ai" ? 1 : -1);
  const rear = grid.hexes.find((hex) => hex.row === primary.row && hex.col === rearCol);
  return rear ? [primaryHexId, rear.id] : null;
}

export function occupiedHexesForStacks(grid, stacks, exceptStackId = null) {
  const occupied = new Set();
  for (const stack of stacks) {
    if (stack.id === exceptStackId || stack.alive === false) continue;
    for (const hexId of footprintHexes(grid, stack) || []) occupied.add(hexId);
  }
  return occupied;
}

export function canStackOccupy(grid, stacks, stack, primaryHexId, extraBlocked = null) {
  const footprint = footprintHexes(grid, stack, primaryHexId);
  if (!footprint) return false;
  const occupied = occupiedHexesForStacks(grid, stacks, stack.id);
  return footprint.every((hexId) => !occupied.has(hexId) && !extraBlocked?.has(hexId));
}

export function placementPreview(grid, stacks, stack, primaryHexId) {
  const hexIds = footprintHexes(grid, stack, primaryHexId);
  return {
    hexIds: hexIds || [primaryHexId],
    primaryHexId,
    valid: Boolean(hexIds && canStackOccupy(grid, stacks, stack, primaryHexId))
  };
}

export function movementPlacementForHex(grid, stack, reachable, hoveredHexId) {
  if (!stack || hoveredHexId === null || hoveredHexId === undefined) return null;
  const primaryIds = [...(reachable || [])];
  if (reachable?.has(hoveredHexId)) {
    const hexIds = footprintHexes(grid, stack, hoveredHexId);
    return hexIds ? { primaryHexId: hoveredHexId, hexIds } : null;
  }
  for (const primaryHexId of primaryIds) {
    const hexIds = footprintHexes(grid, stack, primaryHexId);
    if (hexIds?.includes(hoveredHexId)) return { primaryHexId, hexIds };
  }
  return null;
}

export function stackVisualPosition(grid, stack, primaryHexId = stack?.hexId) {
  const footprint = footprintHexes(grid, stack, primaryHexId) || [primaryHexId];
  const hexes = footprint.map((hexId) => grid.hexes.find((hex) => hex.id === hexId)).filter(Boolean);
  if (!hexes.length) return null;
  return {
    centerX: hexes.reduce((sum, hex) => sum + hex.centerX, 0) / hexes.length,
    centerY: hexes.reduce((sum, hex) => sum + hex.centerY, 0) / hexes.length
  };
}

export function stacksAreAdjacent(grid, first, second, firstPrimaryHexId = first.hexId, secondPrimaryHexId = second.hexId) {
  const firstFootprint = footprintHexes(grid, first, firstPrimaryHexId) || [];
  const secondFootprint = new Set(footprintHexes(grid, second, secondPrimaryHexId) || []);
  return firstFootprint.some((hexId) => {
    const hex = grid.hexes.find((candidate) => candidate.id === hexId);
    return hex?.neighbors.some((neighbor) => secondFootprint.has(neighbor));
  });
}
