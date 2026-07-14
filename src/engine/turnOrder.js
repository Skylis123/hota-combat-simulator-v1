export function computeTurnOrder(stacks, options = {}) {
  const { ascendingSpeed = false, initialLastOwner = null } = options;
  const bySpeed = new Map();
  for (const stack of stacks.filter((candidate) => candidate.alive !== false)) {
    const speed = Number(stack.creature.stats.speed || 0);
    if (!bySpeed.has(speed)) bySpeed.set(speed, []);
    bySpeed.get(speed).push(stack);
  }

  const order = [];
  let lastOwner = initialLastOwner;
  const orderedSpeeds = [...bySpeed.keys()].sort(
    ascendingSpeed ? (left, right) => left - right : (left, right) => right - left
  );
  for (const speed of orderedSpeeds) {
    const speedGroup = bySpeed.get(speed);
    const player = speedGroup.filter((stack) => stack.owner === "player").sort(compareArmyPosition);
    const ai = speedGroup.filter((stack) => stack.owner === "ai").sort(compareArmyPosition);

    while (player.length || ai.length) {
      let next;
      if (player.length && ai.length) {
        // Heroes III gives the attacker priority only when there is no prior
        // action. Afterwards, equal-speed stacks alternate from the side that
        // acted last, including across speed groups and round boundaries.
        next = lastOwner === "player" ? ai.shift() : player.shift();
      } else {
        next = player.shift() || ai.shift();
      }
      order.push(next.id);
      lastOwner = next.owner;
    }
  }
  return order;
}

function compareArmyPosition(left, right) {
  const slotDiff = (left.armySlot ?? 99) - (right.armySlot ?? 99);
  return slotDiff || left.createdAt - right.createdAt;
}

export function nextActiveStack(state) {
  const previousActive = state.stacks.find((stack) => stack.id === state.activeStackId);
  if (previousActive && (previousActive.statuses.acted || previousActive.statuses.waiting)) {
    state.lastMovedOwner = previousActive.owner;
  }

  const pending = pendingTurnOrder(state);
  if (pending.length) return pending[0];
  for (const stack of state.stacks) {
    stack.statuses.acted = false;
    stack.statuses.waiting = false;
    stack.statuses.defending = false;
    stack.statuses.retaliated = false;
    stack.retaliationsUsed = 0;
    stack.defenseBonus = 0;
  }
  state.round += 1;
  state.turnQueue = computeTurnOrder(state.stacks, { initialLastOwner: state.lastMovedOwner });
  return state.turnQueue[0] || null;
}

export function pendingTurnOrder(state) {
  // Rebuild the remaining normal order from the stacks that can still act.
  // A fixed queue becomes incorrect when a stack dies before its turn: its
  // side must not influence equal-speed alternation as if it had acted.
  const available = computeTurnOrder(
    state.stacks.filter((stack) => stack.alive !== false && !stack.statuses.acted && !stack.statuses.waiting),
    { initialLastOwner: state.lastMovedOwner }
  );
  const lastAvailableOwner = available.length
    ? state.stacks.find((stack) => stack.id === available[available.length - 1])?.owner
    : state.lastMovedOwner;
  const waiting = computeTurnOrder(
    state.stacks.filter((stack) => stack.alive !== false && !stack.statuses.acted && stack.statuses.waiting),
    { ascendingSpeed: true, initialLastOwner: lastAvailableOwner }
  );
  return [...available, ...waiting];
}
