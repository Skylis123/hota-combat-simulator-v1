import { nextActiveStack } from "./turnOrder.js";

export const ActionKind = {
  MOVE: "move",
  WAIT: "wait",
  DEFEND: "defend"
};

export function waitStack(state, stack) {
  if (!stack || stack.statuses.acted || stack.statuses.waiting) return false;
  stack.statuses.waiting = true;
  state.actionLog.unshift(`${stack.label} waits.`);
  state.activeStackId = nextActiveStack(state);
  return true;
}

export function defendStack(state, stack) {
  const baseDefense = Number(stack.creature.stats.defense || 0);
  stack.defenseBonus = Math.max(1, Math.floor((baseDefense * 20) / 100));
  stack.statuses.defending = true;
  stack.statuses.acted = true;
  state.actionLog.unshift(`${stack.label} defends (+${stack.defenseBonus} Defense).`);
  state.activeStackId = nextActiveStack(state);
}

export function moveStack(state, stack, hexId) {
  stack.hexId = hexId;
  stack.statuses.acted = true;
  state.actionLog.unshift(`${stack.label} moves to hex ${hexId}.`);
  state.activeStackId = nextActiveStack(state);
}
