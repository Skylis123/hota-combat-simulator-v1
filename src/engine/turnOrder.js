export function computeTurnOrder(stacks) {
  return stacks
    .filter((stack) => stack.alive !== false)
    .sort((a, b) => {
      const speedDiff = (b.creature.stats.speed || 0) - (a.creature.stats.speed || 0);
      if (speedDiff) return speedDiff;
      if (a.owner !== b.owner) return a.owner === "player" ? -1 : 1;
      const slotDiff = (a.armySlot ?? 99) - (b.armySlot ?? 99);
      if (slotDiff) return slotDiff;
      return a.createdAt - b.createdAt;
    })
    .map((stack) => stack.id);
}

export function nextActiveStack(state) {
  const available = state.turnQueue.filter((id) => {
    const stack = state.stacks.find((candidate) => candidate.id === id);
    return stack && stack.alive !== false && !stack.statuses.acted;
  });
  if (available.length) return available[0];
  for (const stack of state.stacks) {
    stack.statuses.acted = false;
    stack.statuses.waiting = false;
    stack.statuses.defending = false;
    stack.statuses.retaliated = false;
    stack.retaliationsUsed = 0;
    stack.defenseBonus = 0;
  }
  state.round += 1;
  state.turnQueue = computeTurnOrder(state.stacks);
  return state.turnQueue[0] || null;
}
