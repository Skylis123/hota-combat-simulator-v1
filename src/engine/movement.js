import { buildHexLookup } from "./hexGrid.js";

export function occupiedHexes(stacks, exceptStackId = null) {
  const occupied = new Set();
  for (const stack of stacks) {
    if (stack.id !== exceptStackId && stack.alive !== false) occupied.add(stack.hexId);
  }
  return occupied;
}

export function reachableHexes(grid, stacks, stack) {
  return new Set(movementPaths(grid, stacks, stack).keys());
}

export function findMovementPath(grid, stacks, stack, destinationHexId) {
  if (!stack) return null;
  return movementPaths(grid, stacks, stack).get(destinationHexId) || null;
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

function movementPaths(grid, stacks, stack) {
  const paths = new Map();
  if (!stack) return paths;
  const blocked = occupiedHexes(stacks, stack.id);
  const speed = Math.max(0, Number(stack.creature.stats.speed || 0));
  const lookup = buildHexLookup(grid);
  const parents = new Map([[stack.hexId, null]]);
  const distances = new Map([[stack.hexId, 0]]);
  const queue = [stack.hexId];
  paths.set(stack.hexId, [stack.hexId]);

  while (queue.length) {
    const hexId = queue.shift();
    const cost = distances.get(hexId);
    const hex = lookup.get(hexId);
    if (!hex || cost >= speed) continue;
    for (const neighbor of hex.neighbors) {
      if (blocked.has(neighbor) || parents.has(neighbor)) continue;
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
