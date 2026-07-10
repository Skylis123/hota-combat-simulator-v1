import { inferAbilityFlags } from "./abilities.js";
import { calculateHpLossValue } from "./combatPower.js";
import { nextActiveStack } from "./turnOrder.js";

export function resurrectionCandidates(state, archangel) {
  if (!archangel || archangel.alive === false || archangel.resurrectionUsed || !inferAbilityFlags(archangel.creature).resurrection) return [];
  return state.stacks.filter((stack) => {
    if (stack.id === archangel.id || stack.owner !== archangel.owner) return false;
    return missingStackHp(stack) > 0;
  });
}

export function chooseBestResurrection(state, archangel) {
  const capacity = Math.max(0, Number(archangel?.count || 0) * 100);
  let best = null;
  for (const target of resurrectionCandidates(state, archangel)) {
    const restoredHp = Math.min(capacity, missingStackHp(target));
    const score = calculateHpLossValue(target, restoredHp).value;
    if (!best || score > best.score || (score === best.score && target.createdAt > best.target.createdAt)) {
      best = { target, restoredHp, score };
    }
  }
  return best;
}

export function executeResurrection(state, archangel, target) {
  if (!resurrectionCandidates(state, archangel).some((candidate) => candidate.id === target?.id)) {
    return { ok: false, reason: "invalid_resurrection_target" };
  }
  const hpPerUnit = Math.max(1, Number(target.creature.stats.hp || 1));
  const restoredHp = Math.min(Number(archangel.count || 0) * 100, missingStackHp(target));
  target.hpTotal = Math.min(maxStackHp(target), Number(target.hpTotal || 0) + restoredHp);
  target.count = Math.ceil(target.hpTotal / hpPerUnit);
  target.wound = target.count * hpPerUnit - target.hpTotal;
  target.alive = target.hpTotal > 0;
  target.statuses.acted = false;
  archangel.resurrectionUsed = true;
  archangel.statuses.acted = true;
  state.actionLog.unshift(`${archangel.label} resurrects ${target.label} for ${restoredHp} HP (${target.count} units).`);
  state.activeStackId = nextActiveStack(state);
  state.selectedStackId = state.activeStackId;
  return { ok: true, restoredHp, target };
}

function maxStackHp(stack) {
  return Math.max(0, Number(stack.initialCount ?? stack.count ?? 0) * Number(stack.creature.stats.hp || 1));
}

function missingStackHp(stack) {
  return Math.max(0, maxStackHp(stack) - Number(stack.hpTotal || 0));
}
