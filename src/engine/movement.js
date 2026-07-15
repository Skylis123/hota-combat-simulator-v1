import { buildHexLookup } from "./hexGrid.js";
import { inferAbilityFlags } from "./abilities.js";
import { canStackOccupy, occupiedHexesForStacks } from "./footprint.js";

export function occupiedHexes(grid, stacks, exceptStackId = null) {
  return occupiedHexesForStacks(grid, stacks, exceptStackId);
}

export function reachableHexes(grid, stacks, stack, extraBlocked = null) {
  return new Set(movementPaths(grid, stacks, stack, extraBlocked).keys());
}

export function findMovementPath(grid, stacks, stack, destinationHexId, extraBlocked = null) {
  if (!stack) return null;
  return movementPaths(grid, stacks, stack, extraBlocked).get(destinationHexId) || null;
}

export function findPath(grid, fromHexId, destinationHexId, blocked = new Set(), maxSteps = Infinity) {
  if (blocked.has(destinationHexId)) return null;
  if (fromHexId === destinationHexId) return [fromHexId];
  const lookup = buildHexLookup(grid);
  const parents = new Map([[fromHexId, null]]);
  const distances = new Map([[fromHexId, 0]]);
  const queue = [fromHexId];

  while (queue.length) {
    const hexId = queue.shift();
    const distance = distances.get(hexId);
    const hex = lookup.get(hexId);
    if (!hex || distance >= maxSteps) continue;
    for (const neighbor of hex.neighbors) {
      if (blocked.has(neighbor) || parents.has(neighbor)) continue;
      parents.set(neighbor, hexId);
      distances.set(neighbor, distance + 1);
      if (neighbor === destinationHexId) return reconstructPath(parents, destinationHexId);
      queue.push(neighbor);
    }
  }

  return null;
}

export function findStackPath(grid, stacks, stack, fromHexId, destinationHexId, maxSteps = Infinity, extraBlocked = null) {
  if (!canStackOccupy(grid, stacks, stack, destinationHexId, extraBlocked)) return null;
  if (fromHexId === destinationHexId) return [fromHexId];
  const lookup = buildHexLookup(grid);
  const parents = new Map([[fromHexId, null]]);
  const distances = new Map([[fromHexId, 0]]);
  const queue = [fromHexId];

  while (queue.length) {
    const hexId = queue.shift();
    const distance = distances.get(hexId);
    const hex = lookup.get(hexId);
    if (!hex || distance >= maxSteps) continue;
    for (const neighbor of hex.neighbors) {
      if (parents.has(neighbor) || !canStackOccupy(grid, stacks, stack, neighbor, extraBlocked)) continue;
      parents.set(neighbor, hexId);
      distances.set(neighbor, distance + 1);
      if (neighbor === destinationHexId) return reconstructPath(parents, destinationHexId);
      queue.push(neighbor);
    }
  }
  return null;
}

function movementPaths(grid, stacks, stack, extraBlocked = null) {
  const paths = new Map();
  if (!stack) return paths;
  const speed = stack.heatStrokeActive ? 0 : Math.max(0, Number(stack.creature.stats.speed || 0));
  const movementAbilities = inferAbilityFlags(stack.creature);
  const ignoresInterveningOccupancy = movementAbilities.flying || movementAbilities.underground;
  const lookup = buildHexLookup(grid);
  const parents = new Map([[stack.hexId, null]]);
  const distances = new Map([[stack.hexId, 0]]);
  const queue = [stack.hexId];
  paths.set(stack.hexId, [stack.hexId]);

  if (ignoresInterveningOccupancy) {
    for (const destination of grid.hexes) {
      if (!canStackOccupy(grid, stacks, stack, destination.id, extraBlocked)) continue;
      const path = findPath(grid, stack.hexId, destination.id, new Set(), speed);
      if (path) paths.set(destination.id, path);
    }
    return paths;
  }

  while (queue.length) {
    const hexId = queue.shift();
    const cost = distances.get(hexId);
    const hex = lookup.get(hexId);
    if (!hex || cost >= speed) continue;
    for (const neighbor of hex.neighbors) {
      if (parents.has(neighbor) || !canStackOccupy(grid, stacks, stack, neighbor, extraBlocked)) continue;
      parents.set(neighbor, hexId);
      distances.set(neighbor, cost + 1);
      paths.set(neighbor, reconstructPath(parents, neighbor));
      queue.push(neighbor);
    }
  }

  return paths;
}

function reconstructPath(parents, destinationHexId) {
  const path = [];
  let current = destinationHexId;
  while (current !== null && current !== undefined) {
    path.push(current);
    current = parents.get(current);
  }
  return path.reverse();
}
