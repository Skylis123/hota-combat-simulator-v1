import { computeTurnOrder } from "./turnOrder.js";

export function createInitialState() {
  return {
    phase: "setup",
    owner: "player",
    selectedCreatureId: null,
    selectedStackId: null,
    stackCount: 20,
    stacks: [],
    turnQueue: [],
    activeStackId: null,
    hoveredStackId: null,
    reachable: new Set(),
    round: 1,
    actionLog: []
  };
}

export function createBattleStack({ creature, owner, hexId, count, createdAt }) {
  return {
    id: `stack_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    creature,
    owner,
    label: `${owner === "ai" ? "AI" : "Player"} ${creature.name}`,
    hexId,
    count,
    hpTotal: count * Number(creature.stats.hp || 1),
    defenseBonus: 0,
    alive: true,
    createdAt,
    statuses: {
      acted: false,
      waiting: false,
      defending: false
    }
  };
}

export function startBattle(state) {
  state.phase = "battle";
  state.round = 1;
  state.turnQueue = computeTurnOrder(state.stacks);
  state.activeStackId = state.turnQueue[0] || null;
  state.selectedStackId = state.activeStackId;
  state.actionLog.unshift("Battle started.");
}

export function resetBattle(state) {
  state.phase = "setup";
  state.turnQueue = [];
  state.activeStackId = null;
  state.selectedStackId = null;
  state.reachable = new Set();
  state.round = 1;
  state.actionLog.unshift("Battle reset to setup.");
  for (const stack of state.stacks) {
    stack.statuses.acted = false;
    stack.statuses.waiting = false;
    stack.statuses.defending = false;
    stack.defenseBonus = 0;
  }
}
