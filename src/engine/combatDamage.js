import {
  FACTORY_AUDITED_COMBAT_CONFIG,
  factoryAbilityFor,
  isStackInvulnerable
} from "./factoryAbilities.js";
import { footprintHexes, stacksAreAdjacent } from "./footprint.js";

export function applyCombatDamage(state, grid, stack, requestedDamage, context = {}) {
  if (!stack || stack.alive === false || Number(stack.count || 0) <= 0) {
    return { damage: 0, death: false, ignored: true, detonation: [] };
  }
  if (!context.ignoreInvulnerability && isStackInvulnerable(stack)) {
    return { damage: 0, death: false, ignored: true, invulnerable: true, detonation: [] };
  }

  const before = snapshotStackHp(stack);
  const damage = Math.max(0, Math.trunc(Number(requestedDamage) || 0));
  const currentTotal = Number.isFinite(stack.hpTotal)
    ? Number(stack.hpTotal)
    : Math.max(0, Number(stack.count || 0) * hpPerUnit(stack) - Number(stack.wound || 0));
  const nextTotal = Math.max(0, currentTotal - damage);
  stack.hpTotal = nextTotal;
  if (nextTotal <= 0) {
    stack.count = 0;
    stack.wound = 0;
    stack.alive = false;
    stack.statuses ||= {};
    stack.statuses.acted = true;
  } else {
    const unitHp = hpPerUnit(stack);
    stack.count = Math.ceil(nextTotal / unitHp);
    stack.wound = stack.count * unitHp - nextTotal;
    stack.alive = true;
  }

  const death = before.alive !== false && before.count > 0 && stack.alive === false;
  const result = {
    damage: Math.min(currentTotal, damage),
    requestedDamage: damage,
    before,
    after: snapshotStackHp(stack),
    death,
    ignored: false,
    detonation: []
  };
  if (!death) return result;

  recordCorpse(state, grid, stack, before);
  return result;
}

export function recordCorpse(state, grid, stack, deathSnapshot = null) {
  if (!state || !stack) return null;
  stack.corpseConsumed = false;
  state.corpses ||= [];
  const existing = state.corpses.find((corpse) => corpse.stackId === stack.id && !corpse.removed && !corpse.consumed);
  if (existing) return existing;
  const corpse = {
    id: `corpse_${stack.id}_${state.corpses.length + 1}`,
    stackId: stack.id,
    owner: stack.owner,
    creatureId: Number(stack.creature?.creatureId),
    hexId: stack.hexId,
    hexIds: grid ? (footprintHexes(grid, stack) || [stack.hexId]) : [stack.hexId],
    consumed: false,
    removed: false,
    round: Number(state.round || 1),
    originalCount: Number(deathSnapshot?.count || stack.initialCount || beforeCount(stack)),
    originalHpTotal: Number(deathSnapshot?.hpTotal || 0)
  };
  state.corpses.push(corpse);
  return corpse;
}

export function removeCorpseForStack(state, stackId) {
  for (const corpse of state?.corpses || []) {
    if (corpse.stackId === stackId && !corpse.consumed) corpse.removed = true;
  }
  const stack = state?.stacks?.find((candidate) => candidate.id === stackId);
  if (stack) stack.corpseConsumed = false;
}

export function isCorpseConsumed(state, stackId) {
  return Boolean((state?.corpses || []).some((corpse) => corpse.stackId === stackId && corpse.consumed));
}

export function availableCorpsesAtHexes(state, hexIds) {
  const wanted = new Set(hexIds || []);
  return (state?.corpses || []).filter((corpse) => (
    !corpse.consumed
    && !corpse.removed
    && (corpse.hexIds || [corpse.hexId]).some((hexId) => wanted.has(hexId))
  ));
}

export function snapshotStackHp(stack) {
  return {
    count: Number(stack?.count || 0),
    hpTotal: Number(stack?.hpTotal || 0),
    wound: Number(stack?.wound || 0),
    alive: stack?.alive !== false
  };
}

function hpPerUnit(stack) {
  return Math.max(1, Number(stack?.creature?.stats?.hp || 1));
}

function beforeCount(stack) {
  return Math.max(1, Number(stack?.count || 1));
}
