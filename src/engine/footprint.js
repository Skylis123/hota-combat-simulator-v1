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

export function canStackOccupy(grid, stacks, stack, primaryHexId) {
  const footprint = footprintHexes(grid, stack, primaryHexId);
  if (!footprint) return false;
  const occupied = occupiedHexesForStacks(grid, stacks, stack.id);
  return footprint.every((hexId) => !occupied.has(hexId));
}

export function stacksAreAdjacent(grid, first, second, firstPrimaryHexId = first.hexId, secondPrimaryHexId = second.hexId) {
  const firstFootprint = footprintHexes(grid, first, firstPrimaryHexId) || [];
  const secondFootprint = new Set(footprintHexes(grid, second, secondPrimaryHexId) || []);
  return firstFootprint.some((hexId) => {
    const hex = grid.hexes.find((candidate) => candidate.id === hexId);
    return hex?.neighbors.some((neighbor) => secondFootprint.has(neighbor));
  });
}
