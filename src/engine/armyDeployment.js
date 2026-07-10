export const ARMY_SLOT_COUNT = 7;

const DEPLOYMENT_ROWS = {
  1: [5],
  2: [2, 8],
  3: [2, 5, 8],
  4: [0, 4, 6, 10],
  5: [0, 2, 5, 8, 10],
  6: [0, 2, 4, 6, 8, 10],
  7: [0, 2, 4, 5, 6, 8, 10]
};

export function deploymentRows(stackCount) {
  return [...(DEPLOYMENT_ROWS[Math.max(1, Math.min(ARMY_SLOT_COUNT, stackCount))] || [])];
}

export function armyStacks(stacks, owner) {
  return stacks
    .filter((stack) => stack.owner === owner)
    .sort((first, second) => (first.armySlot ?? ARMY_SLOT_COUNT) - (second.armySlot ?? ARMY_SLOT_COUNT));
}

export function deployArmy(grid, stacks, owner) {
  const ordered = armyStacks(stacks, owner);
  const rows = deploymentRows(ordered.length);
  const primaryCol = owner === "player" ? 1 : 13;
  ordered.forEach((stack, index) => {
    const hex = grid.hexes.find((candidate) => candidate.row === rows[index] && candidate.col === primaryCol);
    if (hex) stack.hexId = hex.id;
  });
  return ordered;
}

export function deployAllArmies(grid, stacks) {
  deployArmy(grid, stacks, "player");
  deployArmy(grid, stacks, "ai");
  return stacks;
}

export function stackInArmySlot(stacks, owner, armySlot) {
  return stacks.find((stack) => stack.owner === owner && stack.armySlot === armySlot) || null;
}
