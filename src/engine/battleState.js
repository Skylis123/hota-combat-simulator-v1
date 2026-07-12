import { computeTurnOrder } from "./turnOrder.js";

export function createInitialState() {
  return {
    phase: "setup",
    owner: "player",
    backgroundId: "cmbkgrtr",
    obstacleCategory: "grass",
    selectedObstacleId: null,
    obstacles: [],
    obstacleBlockedHexIds: new Set(),
    selectedCreatureId: null,
    selectedStackId: null,
    stackCount: 1,
    stacks: [],
    turnQueue: [],
    activeStackId: null,
    winner: null,
    hoveredStackId: null,
    reachable: new Set(),
    enemyTargetIds: new Set(),
    attackableTargetIds: new Set(),
    setupPreview: null,
    attackPreview: null,
    battleSetupSnapshot: null,
    round: 1,
    actionLog: []
  };
}

export function createBattleStack({ creature, owner, hexId, count, createdAt, armySlot = null }) {
  return {
    id: `stack_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    creature,
    owner,
    label: `${owner === "ai" ? "AI" : "Player"} ${creature.name}`,
    hexId,
    count,
    initialCount: count,
    hpTotal: count * Number(creature.stats.hp || 1),
    wound: 0,
    effects: [],
    maxShots: Number(creature.stats.shots || 0),
    shotsRemaining: Number(creature.stats.shots || 0),
    defenseBonus: 0,
    retaliationsUsed: 0,
    resurrectionUsed: false,
    alive: true,
    createdAt,
    armySlot,
    statuses: {
      acted: false,
      waiting: false,
      defending: false,
      retaliated: false
    }
  };
}

export function setSetupStackCount(stack, requestedCount) {
  const count = Math.max(1, Math.min(9999, Math.trunc(Number(requestedCount) || 1)));
  stack.count = count;
  stack.initialCount = count;
  stack.hpTotal = count * Number(stack.creature.stats.hp || 1);
  stack.wound = 0;
  stack.alive = true;
  return count;
}

export function startBattle(state) {
  state.battleSetupSnapshot = state.stacks.map(cloneStack);
  state.phase = "battle";
  state.winner = null;
  state.round = 1;
  state.attackPreview = null;
  for (const stack of state.stacks) {
    stack.alive = stack.count > 0;
    stack.hpTotal = stack.hpTotal || stack.count * Number(stack.creature.stats.hp || 1);
    stack.wound = stack.wound || 0;
    stack.shotsRemaining = Number.isFinite(stack.shotsRemaining) ? stack.shotsRemaining : Number(stack.creature.stats.shots || 0);
    stack.statuses.acted = false;
    stack.statuses.waiting = false;
    stack.statuses.defending = false;
    stack.statuses.retaliated = false;
    stack.retaliationsUsed = 0;
    stack.resurrectionUsed = false;
    stack.defenseBonus = 0;
  }
  state.turnQueue = computeTurnOrder(state.stacks);
  state.activeStackId = state.turnQueue[0] || null;
  state.selectedStackId = state.activeStackId;
  state.actionLog.unshift("Battle started.");
}

export function resetBattle(state) {
  if (state.battleSetupSnapshot) {
    state.stacks = state.battleSetupSnapshot.map(cloneStack);
  }
  state.phase = "setup";
  state.turnQueue = [];
  state.activeStackId = null;
  state.winner = null;
  state.selectedStackId = null;
  state.reachable = new Set();
  state.enemyTargetIds = new Set();
  state.attackableTargetIds = new Set();
  state.attackPreview = null;
  state.selectedObstacleId = null;
  state.round = 1;
  state.actionLog.unshift("Battle reset to setup.");
}

function cloneStack(stack) {
  return {
    ...stack,
    effects: (stack.effects || []).map((effect) => ({ ...effect })),
    statuses: { ...stack.statuses }
  };
}
