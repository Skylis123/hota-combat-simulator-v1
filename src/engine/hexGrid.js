export function buildHexLookup(grid) {
  const byId = new Map();
  for (const hex of grid.hexes) byId.set(hex.id, hex);
  return byId;
}

export function polygonPointsToString(points) {
  return points.map((point) => `${point[0]},${point[1]}`).join(" ");
}

export function isValidHex(grid, hexId) {
  return grid.hexes.some((hex) => hex.id === hexId);
}

export function distanceByBreadthFirst(grid, fromHex, toHex) {
  if (fromHex === toHex) return 0;
  const lookup = buildHexLookup(grid);
  const queue = [[fromHex, 0]];
  const visited = new Set([fromHex]);
  while (queue.length) {
    const [hexId, distance] = queue.shift();
    const hex = lookup.get(hexId);
    if (!hex) continue;
    for (const neighbor of hex.neighbors) {
      if (neighbor === toHex) return distance + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, distance + 1]);
      }
    }
  }
  return Infinity;
}
