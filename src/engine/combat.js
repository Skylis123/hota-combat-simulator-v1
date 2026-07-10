import { inferAbilityFlags } from "./abilities.js";
import { calculateExpectedDamage, calculateHpLossValue, calculateTargetPriority } from "./combatPower.js";
import { distanceByBreadthFirst } from "./hexGrid.js";
import { occupiedHexes, reachableHexes } from "./movement.js";
import { nextActiveStack } from "./turnOrder.js";

export function livingStacks(state, owner = null) {
  return state.stacks.filter((stack) => stack.alive !== false && stack.count > 0 && (!owner || stack.owner === owner));
}

export function livingEnemies(state, stack) {
  return livingStacks(state).filter((candidate) => candidate.owner !== stack.owner);
}

export function battleWinner(state) {
  const players = livingStacks(state, "player").length;
  const ai = livingStacks(state, "ai").length;
  if (players && ai) return null;
  if (players) return "player";
  if (ai) return "ai";
  return "draw";
}

export function isAdjacent(grid, a, b) {
  const hex = grid.hexes.find((candidate) => candidate.id === a);
  return Boolean(hex?.neighbors.includes(b));
}

export function canUseRangedAttack(attacker, grid, target) {
  const abilities = inferAbilityFlags(attacker.creature);
  return abilities.ranged && Number(attacker.shotsRemaining || 0) > 0 && !isAdjacent(grid, attacker.hexId, target.hexId);
}

export function findApproachHex(grid, state, attacker, target) {
  if (isAdjacent(grid, attacker.hexId, target.hexId)) return attacker.hexId;
  const targetHex = grid.hexes.find((hex) => hex.id === target.hexId);
  if (!targetHex) return null;
  const reachable = reachableHexes(grid, state.stacks, attacker);
  const occupied = occupiedHexes(state.stacks, attacker.id);
  let best = null;
  let bestDistance = Infinity;
  for (const neighbor of targetHex.neighbors) {
    if (!reachable.has(neighbor) || occupied.has(neighbor)) continue;
    const distance = distanceByBreadthFirst(grid, attacker.hexId, neighbor);
    if (distance < bestDistance || (distance === bestDistance && neighbor < best)) {
      best = neighbor;
      bestDistance = distance;
    }
  }
  return best;
}

export function attackOption(grid, state, attacker, target) {
  if (!attacker || !target || attacker.owner === target.owner || target.alive === false) {
    return { canAttack: false, reason: "invalid_target" };
  }
  if (canUseRangedAttack(attacker, grid, target)) {
    return { canAttack: true, mode: "ranged", approachHex: attacker.hexId };
  }
  const approachHex = findApproachHex(grid, state, attacker, target);
  if (approachHex === null) return { canAttack: false, reason: "no_reachable_contact_hex" };
  return { canAttack: true, mode: "melee", approachHex };
}

export function chooseBestAttack(grid, state, attacker) {
  let best = null;
  for (const target of livingEnemies(state, attacker)) {
    const option = attackOption(grid, state, attacker, target);
    if (!option.canAttack) continue;
    const score = scoreAttackOption(attacker, target, option);
    if (!best || score > best.score || (score === best.score && target.hexId > best.target.hexId)) {
      best = { target, option, score };
    }
  }
  return best;
}

export function chooseAdvanceHex(grid, state, stack) {
  const enemies = livingEnemies(state, stack);
  const reachable = reachableHexes(grid, state.stacks, stack);
  const occupied = occupiedHexes(state.stacks, stack.id);
  let bestHex = stack.hexId;
  let bestDistance = nearestEnemyDistance(grid, stack.hexId, enemies);
  for (const hexId of reachable) {
    if (occupied.has(hexId)) continue;
    const distance = nearestEnemyDistance(grid, hexId, enemies);
    if (distance < bestDistance || (distance === bestDistance && hexId > bestHex)) {
      bestDistance = distance;
      bestHex = hexId;
    }
  }
  return bestHex;
}

export function executeAttack(state, grid, attacker, target, option = attackOption(grid, state, attacker, target)) {
  if (!option.canAttack) {
    state.actionLog.unshift(`${attacker.label} cannot attack ${target.label}.`);
    return { ok: false, reason: option.reason };
  }

  const moved = option.approachHex !== attacker.hexId;
  if (moved) attacker.hexId = option.approachHex;

  const mode = option.mode === "ranged" ? "ranged" : "melee";
  if (mode === "ranged") attacker.shotsRemaining = Math.max(0, Number(attacker.shotsRemaining || 0) - 1);

  attacker.statuses.defending = false;
  const attackLog = [];
  const abilities = inferAbilityFlags(attacker.creature);
  const strikes = abilities.doubleAttack ? 2 : 1;
  let retaliation = null;

  for (let strike = 1; strike <= strikes; strike += 1) {
    if (attacker.alive === false || target.alive === false) break;
    const damage = calculateExpectedDamage(attacker, target, state, { includeMultiHit: false }).damage;
    const before = snapshotHp(target);
    applyDamage(target, damage);
    attackLog.push({ strike, attacker: attacker.id, target: target.id, damage, before, after: snapshotHp(target) });

    if (strike === 1 && mode === "melee" && target.alive !== false && canRetaliate(target, attacker)) {
      const retaliationDamage = calculateExpectedDamage(target, attacker, state, { includeMultiHit: false }).damage;
      const retaliationBefore = snapshotHp(attacker);
      applyDamage(attacker, retaliationDamage);
      target.statuses.retaliated = true;
      retaliation = {
        attacker: target.id,
        target: attacker.id,
        damage: retaliationDamage,
        before: retaliationBefore,
        after: snapshotHp(attacker)
      };
    }
  }

  attacker.statuses.acted = true;
  const actionText = describeAttack(attacker, target, mode, moved, attackLog, retaliation);
  state.actionLog.unshift(actionText);
  finishAction(state);
  return { ok: true, mode, moved, attackLog, retaliation };
}

export async function performAiTurn(state, grid, hooks = {}) {
  const stack = state.stacks.find((candidate) => candidate.id === state.activeStackId);
  if (!stack || stack.owner !== "ai" || stack.alive === false) return;

  const attack = chooseBestAttack(grid, state, stack);
  if (attack) {
    await hooks.beforeAttack?.(stack, attack.target, attack.option);
    executeAttack(state, grid, stack, attack.target, attack.option);
    return;
  }

  const advanceHex = chooseAdvanceHex(grid, state, stack);
  if (advanceHex !== stack.hexId) {
    await hooks.beforeMove?.(stack, advanceHex);
    stack.hexId = advanceHex;
    stack.statuses.acted = true;
    state.actionLog.unshift(`${stack.label} advances to hex ${advanceHex}.`);
    finishAction(state);
    return;
  }

  stack.statuses.defending = true;
  stack.defenseBonus = Math.max(1, Math.floor(Number(stack.creature.stats.defense || 0) * 0.2));
  stack.statuses.acted = true;
  state.actionLog.unshift(`${stack.label} defends.`);
  finishAction(state);
}

function scoreAttackOption(attacker, target, option) {
  if (option.mode === "ranged") {
    const damage = calculateExpectedDamage(attacker, target).damage;
    return calculateHpLossValue(target, damage).value;
  }
  const exchange = calculateTargetPriority(attacker, target);
  const movePenalty = option.approachHex === attacker.hexId ? 0 : 5;
  return exchange.score - movePenalty;
}

function canRetaliate(defender, attacker) {
  if (defender.statuses.retaliated) return false;
  const attackerAbilities = inferAbilityFlags(attacker.creature);
  if (attackerAbilities.noRetaliation) return false;
  return defender.alive !== false && defender.count > 0;
}

function applyDamage(stack, damage) {
  const hpPerUnit = Math.max(1, Number(stack.creature.stats.hp || 1));
  const currentTotal = Number.isFinite(stack.hpTotal)
    ? stack.hpTotal
    : Math.max(0, stack.count * hpPerUnit - Number(stack.wound || 0));
  const nextTotal = Math.max(0, currentTotal - Math.max(0, Math.trunc(damage)));
  stack.hpTotal = nextTotal;
  if (nextTotal <= 0) {
    stack.count = 0;
    stack.wound = 0;
    stack.alive = false;
    stack.statuses.acted = true;
    return;
  }
  stack.count = Math.ceil(nextTotal / hpPerUnit);
  stack.wound = stack.count * hpPerUnit - nextTotal;
  stack.alive = true;
}

function finishAction(state) {
  const winner = battleWinner(state);
  if (winner) {
    state.phase = "finished";
    state.winner = winner;
    state.activeStackId = null;
    state.selectedStackId = null;
    state.actionLog.unshift(winner === "draw" ? "Battle ends in a draw." : `${winner.toUpperCase()} wins the battle.`);
    return;
  }
  state.activeStackId = nextActiveStack(state);
  state.selectedStackId = state.activeStackId;
}

function snapshotHp(stack) {
  return {
    count: stack.count,
    hpTotal: stack.hpTotal,
    wound: stack.wound
  };
}

function nearestEnemyDistance(grid, hexId, enemies) {
  let best = Infinity;
  for (const enemy of enemies) best = Math.min(best, distanceByBreadthFirst(grid, hexId, enemy.hexId));
  return best;
}

function describeAttack(attacker, target, mode, moved, attackLog, retaliation) {
  const totalDamage = attackLog.reduce((sum, entry) => sum + entry.damage, 0);
  const movement = moved ? "moves and " : "";
  const targetState = target.alive === false ? "target killed" : `${target.count} left`;
  const retaliationText = retaliation ? ` Retaliation: ${retaliation.damage}.` : "";
  return `${attacker.label} ${movement}${mode === "ranged" ? "shoots" : "attacks"} ${target.label} for ${totalDamage}. ${targetState}.${retaliationText}`;
}
