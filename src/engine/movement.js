import { buildHexLookup } from "./hexGrid.js";

export function occupiedHexes(stacks, exceptStackId = null) {
  const occupied = new Set();
  for (const stack of stacks) {
    if (stack.id !== exceptStackId && stack.alive !== false) occupied.add(stack.hexId);
  }
  return occupied;
}

export function reachableHexes(grid, stacks, stack) {
  if (!stack) return new Set();
  const lookup = buildHexLookup(grid);
  const blocked = occupiedHexes(stacks, stack.id);
  const speed = Math.max(0, Number(stack.creature.stats.speed || 0));
  const reachable = new Set([stack.hexId]);
  const queue = [[stack.hexId, 0]];

  while (queue.length) {
    const [hexId, cost] = queue.shift();
    const hex = lookup.get(hexId);
    if (!hex || cost >= speed) continue;
    for (const neighbor of hex.neighbors) {
      if (blocked.has(neighbor) || reachable.has(neighbor)) continue;
      reachable.add(neighbor);
      queue.push([neighbor, cost + 1]);
    }
  }

  return reachable;
}
