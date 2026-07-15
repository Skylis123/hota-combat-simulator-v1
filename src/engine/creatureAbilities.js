import { inferAbilityFlags } from "./abilities.js";
import { calculateExpectedDamage, calculateHpLossValue, calculateRolledDamage } from "./combatPower.js";
import {
  FACTORY_AUDITED_COMBAT_CONFIG,
  factoryAbilityFor,
  initializeFactoryStackState,
  isFactoryMechanical,
  isStackInvulnerable
} from "./factoryAbilities.js";
import {
  applyCombatDamage,
  availableCorpsesAtHexes,
  isCorpseConsumed,
  removeCorpseForStack
} from "./combatDamage.js";
import { footprintHexes, stacksAreAdjacent } from "./footprint.js";
import { distanceByBreadthFirst } from "./hexGrid.js";
import { findMovementPath } from "./movement.js";
import { nextActiveStack } from "./turnOrder.js";

export function resurrectionCandidates(state, archangel) {
  if (!archangel || archangel.alive === false || archangel.resurrectionUsed || !inferAbilityFlags(archangel.creature).resurrection) return [];
  return state.stacks.filter((stack) => {
    if (stack.id === archangel.id || stack.owner !== archangel.owner) return false;
    if (isFactoryMechanical(stack) || isCorpseConsumed(state, stack.id)) return false;
    return missingStackHp(stack) > 0;
  });
}

export function chooseBestResurrection(state, archangel) {
  const capacity = Math.max(0, Number(archangel?.count || 0) * 100);
  let best = null;
  for (const target of resurrectionCandidates(state, archangel)) {
    const restoredHp = Math.min(capacity, missingStackHp(target));
    const score = restorationValue(target, restoredHp);
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
  const restoredHp = Math.min(Number(archangel.count || 0) * 100, missingStackHp(target));
  restoreStackHp(state, target, restoredHp);
  archangel.resurrectionUsed = true;
  archangel.statuses.acted = true;
  state.actionLog.unshift(`${archangel.label} resurrects ${target.label} for ${restoredHp} HP (${target.count} units).`);
  state.activeStackId = nextActiveStack(state);
  state.selectedStackId = state.activeStackId;
  return { ok: true, restoredHp, target };
}

export function repairCandidates(state, repairer) {
  const ability = factoryAbilityFor(repairer);
  initializeFactoryStackState(repairer);
  if (!repairer || repairer.alive === false || !ability?.repair || Number(repairer.repairUsesRemaining || 0) <= 0) return [];
  const allowed = new Set(ability.repair.targetCreatureIds || []);
  return (state?.stacks || []).filter((target) => (
    target.id !== repairer.id
    && target.owner === repairer.owner
    && allowed.has(Number(target.creature?.creatureId))
    && !isCorpseConsumed(state, target.id)
    && missingStackHp(target) > 0
  ));
}

export function repairApproachOptions(grid, state, repairer, target) {
  if (!grid) return [{ approachHex: repairer.hexId, approachPath: [repairer.hexId] }];
  const options = [];
  for (const candidate of grid.hexes) {
    if (!stacksAreAdjacent(grid, repairer, target, candidate.id)) continue;
    const path = findMovementPath(grid, state.stacks, repairer, candidate.id, state.obstacleBlockedHexIds);
    if (path) options.push({ approachHex: candidate.id, approachPath: path });
  }
  return options;
}

export function chooseBestRepair(state, repairer, grid = null) {
  const ability = factoryAbilityFor(repairer);
  const capacity = Math.max(0, Number(repairer?.count || 0) * Number(ability?.repair?.hpPerUnit || 0));
  let best = null;
  for (const target of repairCandidates(state, repairer)) {
    const approaches = repairApproachOptions(grid, state, repairer, target);
    if (!approaches.length) continue;
    const approach = approaches.reduce((shortest, candidate) => (
      !shortest || candidate.approachPath.length < shortest.approachPath.length ? candidate : shortest
    ), null);
    const restoredHp = Math.min(capacity, missingStackHp(target));
    const score = restorationValue(target, restoredHp) - Math.max(0, approach.approachPath.length - 1) * 5;
    if (!best || score > best.score || (score === best.score && target.createdAt > best.target.createdAt)) {
      best = { target, restoredHp, score, ...approach };
    }
  }
  return best;
}

export function executeRepair(state, repairer, target, option = {}) {
  const ability = factoryAbilityFor(repairer);
  if (!repairCandidates(state, repairer).some((candidate) => candidate.id === target?.id)) {
    return { ok: false, reason: "invalid_repair_target" };
  }
  if (option.grid) {
    const approaches = repairApproachOptions(option.grid, state, repairer, target);
    const selected = approaches.find((candidate) => candidate.approachHex === option.approachHex) || approaches[0];
    if (!selected) return { ok: false, reason: "repair_target_unreachable" };
    repairer.hexId = selected.approachHex;
  }
  const capacity = Math.max(0, Number(repairer.count || 0) * Number(ability.repair.hpPerUnit || 0));
  const restoredHp = Math.min(capacity, missingStackHp(target));
  restoreStackHp(state, target, restoredHp);
  const negativeEffects = (target.effects || []).filter((effect) => effect?.negative === true || [
    "age", "berserk", "blind", "disease", "forgetfulness", "hypnotize", "paralyze", "petrify", "poison", "slow", "sorrow", "stone", "stone_gaze", "weakness"
  ].includes(String(effect?.type || "").toLowerCase()));
  target.effects = (target.effects || []).filter((effect) => !negativeEffects.includes(effect));
  repairer.repairUsesRemaining = Math.max(0, Number(repairer.repairUsesRemaining || 0) - 1);
  repairer.statuses ||= {};
  repairer.statuses.acted = true;
  state.actionLog?.unshift(`${repairer.label} repairs ${target.label} for ${restoredHp} HP (${target.count} units).`);
  advanceAfterCreatureAction(state);
  return { ok: true, restoredHp, dispelledEffects: negativeEffects, target };
}

export function activateDetonation(state, stack) {
  const ability = factoryAbilityFor(stack);
  initializeFactoryStackState(stack);
  if (!ability?.detonation || stack?.alive === false) return { ok: false, reason: "detonation_unavailable" };
  if (stack.detonationActive) return { ok: false, reason: "detonation_already_active" };
  stack.detonationActive = true;
  state?.actionLog?.unshift(`${stack.label} arms Ignition for its next attack.`);
  return { ok: true, consumesTurn: Boolean(ability.detonation.activationConsumesTurn) };
}

export function activateTemporaryInvulnerability(state, stack) {
  const ability = factoryAbilityFor(stack);
  initializeFactoryStackState(stack);
  const config = ability?.temporaryInvulnerability;
  if (!config || stack?.alive === false || Number(stack.invulnerabilityUsesRemaining || 0) <= 0) {
    return { ok: false, reason: "temporary_invulnerability_unavailable" };
  }
  stack.invulnerabilityUsesRemaining -= 1;
  stack.invulnerable = true;
  stack.invulnerableUntilOwnTurn = true;
  const consumesTurn = Boolean(config.activationConsumesTurn);
  state?.actionLog?.unshift(`${stack.label} becomes temporarily invulnerable.`);
  if (consumesTurn) {
    stack.statuses ||= {};
    stack.statuses.acted = true;
    advanceAfterCreatureAction(state);
  }
  return { ok: true, consumesTurn };
}

export function canUsePreemptiveShot(stack, context = {}) {
  const ability = factoryAbilityFor(stack);
  initializeFactoryStackState(stack);
  const limit = ability?.preemptiveShot?.usesPerRound;
  return Boolean(
    limit !== undefined
    && stack?.alive !== false
    && Number(stack?.count || 0) > 0
    && Number(stack?.shotsRemaining || 0) > 0
    && Number(stack?.preemptiveShotsUsedThisRound || 0) < limit
    && context.incomingMode === "ranged"
    && !(context.grid && (context.state?.stacks || []).some((enemy) => enemy.owner !== stack.owner && enemy.alive !== false && stacksAreAdjacent(context.grid, stack, enemy)))
  );
}

export function consumePreemptiveShot(stack, context = {}) {
  if (!canUsePreemptiveShot(stack, context)) return false;
  stack.preemptiveShotsUsedThisRound = Number(stack.preemptiveShotsUsedThisRound || 0) + 1;
  stack.shotsRemaining = Math.max(0, Number(stack.shotsRemaining || 0) - 1);
  return true;
}

export function executeCorpseDevour(state, grid, stack, destinationHexId = stack?.hexId) {
  const ability = factoryAbilityFor(stack);
  initializeFactoryStackState(stack);
  if (!ability?.corpseDevour || stack?.alive === false || Number(stack.corpseDevourUsesRemaining || 0) <= 0) {
    return { ok: false, reason: "corpse_devour_unavailable" };
  }
  const corpses = availableCorpsesAtHexes(state, [destinationHexId]);
  if (!corpses.length) return { ok: false, reason: "no_corpse_at_destination" };
  const corpse = corpses[0];
  const summonHexId = (corpse.hexIds || [corpse.hexId]).find((hexId) => !livingStackOccupiesHex(state, grid, hexId));
  if (summonHexId === undefined) return { ok: false, reason: "corpse_hex_occupied" };
  corpse.consumed = true;
  const fallen = state?.stacks?.find((candidate) => candidate.id === corpse.stackId);
  if (fallen) fallen.corpseConsumed = true;
  const corpseHp = Math.max(1, Number(corpse.originalHpTotal || corpse.originalCount || 1));
  const casterHp = Math.max(1, Number(stack.hpTotal || (stack.count * stack.creature.stats.hp)));
  const larvaCount = Math.max(1, Math.min(corpseHp, casterHp));
  const larva = createSandwormLarvaStack(state, stack, summonHexId, larvaCount);
  stack.corpseDevourUsesRemaining = Math.max(0, Number(stack.corpseDevourUsesRemaining || 0) - 1);
  stack.statuses ||= {};
  stack.statuses.acted = true;
  state.actionLog?.unshift(`${stack.label} devours ${fallen?.label || "a corpse"} and summons ${larvaCount} temporary Sandworm Larva${larvaCount === 1 ? "" : "s"}.`);
  advanceAfterCreatureAction(state);
  return { ok: true, corpse, larva, larvaCount };
}

export function chooseBestCorpseDevour(state, grid, stack) {
  const ability = factoryAbilityFor(stack);
  initializeFactoryStackState(stack);
  if (!ability?.corpseDevour || stack?.alive === false || Number(stack.corpseDevourUsesRemaining || 0) <= 0) return null;
  let best = null;
  for (const corpse of state?.corpses || []) {
    if (corpse.consumed || corpse.removed) continue;
    const destinationHexId = (corpse.hexIds || [corpse.hexId]).find((hexId) => !livingStackOccupiesHex(state, grid, hexId));
    if (destinationHexId === undefined) continue;
    const corpseHp = Math.max(1, Number(corpse.originalHpTotal || corpse.originalCount || 1));
    const casterHp = Math.max(1, Number(stack.hpTotal || (stack.count * stack.creature.stats.hp)));
    const larvaCount = Math.max(1, Math.min(corpseHp, casterHp));
    const score = larvaCount;
    if (!best || score > best.score) best = { corpse, destinationHexId, larvaCount, score };
  }
  return best;
}

export function activateHeatStroke(state, stack) {
  const ability = factoryAbilityFor(stack);
  initializeFactoryStackState(stack);
  if (!ability?.heatStroke || stack?.alive === false || Number(stack.heatStrokeUsesRemaining || 0) <= 0) {
    return { ok: false, reason: "heat_stroke_unavailable" };
  }
  if (stack.heatStrokeActive) return { ok: false, reason: "heat_stroke_already_active" };
  stack.heatStrokeUsesRemaining = Math.max(0, Number(stack.heatStrokeUsesRemaining || 0) - 1);
  stack.heatStrokeActive = true;
  stack.heatStrokeExpiresOnTurnStart = true;
  state?.actionLog?.unshift(`${stack.label} activates Heat Stroke for its next attack.`);
  return { ok: true, consumesTurn: false };
}

export function resolveArmedFactoryAttack(state, grid, stack, primaryTarget) {
  const hits = [];
  if (stack?.heatStrokeActive) {
    const attackDirection = stackAttackDirection(grid, stack, primaryTarget);
    const option = heatStrokeOptions(grid, state, stack).find((candidate) => candidate.orientation === attackDirection);
    for (const target of option?.targets || []) {
      if (target.id === primaryTarget?.id || isStackInvulnerable(target)) continue;
      const damage = calculateRolledDamage(stack, target, state, { mode: "melee", includeMultiHit: false, rng: state?.rng }).damage;
      const result = applyCombatDamage(state, grid, target, damage, { source: stack, kind: "heat_stroke" });
      hits.push({ target: target.id, damage: result.damage, result });
    }
    stack.heatStrokeActive = false;
    stack.heatStrokeExpiresOnTurnStart = false;
  }
  if (stack?.detonationActive && !stack.detonationResolved) {
    const config = FACTORY_AUDITED_COMBAT_CONFIG.detonation;
    const damage = config.damagePerUnit * Math.max(1, Number(stack.count || 1));
    const targetHexes = footprintHexes(grid, primaryTarget) || [primaryTarget?.hexId];
    for (const target of state?.stacks || []) {
      if (target.id === stack.id || target.alive === false || isStackInvulnerable(target)) continue;
      const inRange = (footprintHexes(grid, target) || []).some((hexId) => targetHexes.some((origin) => distanceByBreadthFirst(grid, origin, hexId) <= 2));
      if (!inRange) continue;
      const result = applyCombatDamage(state, grid, target, damage, { source: stack, kind: "detonation" });
      hits.push({ target: target.id, damage: result.damage, result, detonation: true });
    }
    stack.detonationActive = false;
    stack.detonationResolved = true;
    applyCombatDamage(state, grid, stack, Number(stack.hpTotal || 0), { source: stack, kind: "disintegrate", ignoreInvulnerability: true });
    removeCorpseForStack(state, stack.id);
    stack.corpseConsumed = true;
  }
  return hits;
}

export function breathSplashTarget(grid, state, attacker, primaryTarget, option = {}) {
  if (!inferAbilityFlags(attacker?.creature).breathAttack || !grid) return null;
  const attackerFootprint = footprintHexes(grid, attacker, option.approachHex ?? attacker.hexId) || [];
  const targetFootprint = footprintHexes(grid, primaryTarget) || [];
  const pairs = [];
  for (const attackerHexId of attackerFootprint) {
    const attackerHex = grid.hexes.find((hex) => hex.id === attackerHexId);
    if (!attackerHex) continue;
    for (const targetHexId of targetFootprint) {
      if (option.targetHexId != null && option.targetHexId !== targetHexId) continue;
      const targetHex = grid.hexes.find((hex) => hex.id === targetHexId);
      if (targetHex?.neighbors.includes(attackerHexId)) pairs.push({ attackerHex, targetHex });
    }
  }
  const contact = pairs[0];
  if (!contact) return null;
  const vectorX = contact.targetHex.centerX - contact.attackerHex.centerX;
  const vectorY = contact.targetHex.centerY - contact.attackerHex.centerY;
  const vectorLength = Math.hypot(vectorX, vectorY) || 1;
  let behindHex = null;
  let bestAlignment = 0.7;
  for (const neighborId of contact.targetHex.neighbors) {
    if (attackerFootprint.includes(neighborId)) continue;
    const neighbor = grid.hexes.find((hex) => hex.id === neighborId);
    if (!neighbor) continue;
    const nextX = neighbor.centerX - contact.targetHex.centerX;
    const nextY = neighbor.centerY - contact.targetHex.centerY;
    const alignment = (vectorX * nextX + vectorY * nextY) / (vectorLength * (Math.hypot(nextX, nextY) || 1));
    if (alignment > bestAlignment) {
      bestAlignment = alignment;
      behindHex = neighbor;
    }
  }
  if (!behindHex) return null;
  return (state?.stacks || []).find((candidate) => (
    candidate.id !== attacker.id
    && candidate.id !== primaryTarget.id
    && candidate.alive !== false
    && !isStackInvulnerable(candidate)
    && (footprintHexes(grid, candidate) || []).includes(behindHex.id)
  )) || null;
}

export function heatStrokeOptions(grid, state, stack) {
  const ability = factoryAbilityFor(stack);
  if (!ability?.heatStroke || stack?.alive === false || !grid) return [];
  const config = FACTORY_AUDITED_COMBAT_CONFIG.heatStroke;
  return Array.from({ length: config.orientationCount }, (_, orientation) => {
    const affectedHexIds = heatStrokeHexes(grid, stack, orientation);
    const affectedSet = new Set(affectedHexIds);
    const targets = (state?.stacks || []).filter((candidate) => (
      candidate.id !== stack.id
      && candidate.alive !== false
      && (footprintHexes(grid, candidate) || []).some((hexId) => affectedSet.has(hexId))
    ));
    const score = targets.reduce((sum, target) => {
      if (isStackInvulnerable(target)) return sum;
      const damage = calculateExpectedDamage(stack, target, state, { mode: "melee", includeMultiHit: false }).damage;
      const value = calculateHpLossValue(target, damage).value;
      return sum + (target.owner === stack.owner ? -value : value);
    }, 0);
    return { orientation, affectedHexIds, targets, score, config };
  });
}

export function chooseBestHeatStroke(grid, state, stack) {
  if (stack?.heatStrokeActive) return null;
  return heatStrokeOptions(grid, state, stack).reduce((best, option) => (
    !best
    || option.score > best.score
    || (option.score === best.score && option.targets.length > best.targets.length)
      ? option
      : best
  ), null);
}

export function executeHeatStroke(state, grid, stack, requestedOrientation) {
  return activateHeatStroke(state, stack);
}

function createSandwormLarvaStack(state, summoner, hexId, count) {
  const id = `summoned_larva_${summoner.id}_${(state.stacks || []).length + 1}`;
  const creature = {
    creatureId: 10001, name: "Sandworm Larva", faction: "Factory", summonOnly: true, doubleWide: false,
    stats: { attack: 3, defense: 2, minDamage: 1, maxDamage: 3, hp: 1, speed: 18, shots: 0, aiValue: 982, fightValue: 899 },
    asset: {
      displayImage: "assets/creatures/png/10001.png",
      idleAnimation: "assets/creatures/animations/10001/idle.gif",
      previewImage: "assets/creatures/png/10001.png",
      spritesheet: "assets/creatures/spritesheets/10001.png",
      corpseImage: "assets/creatures/animations/10001/corpse.png",
      battleAnimationRoot: "assets/creatures/animations/10001",
      battleAnimationActions: ["move", "idle", "hit", "defend", "death", "attack-front", "corpse"],
      assetStatus: "EXTRACTED"
    }
  };
  const larva = {
    id, creature, owner: summoner.owner, label: `${summoner.owner} Sandworm Larva`, hexId,
    count, initialCount: count, hpTotal: count, wound: 0, effects: [], shotsRemaining: 0, maxShots: 0,
    retaliationsUsed: 0, defenseBonus: 0, alive: true, createdAt: Date.now(), temporarySummon: true,
    statuses: { acted: true, waiting: false, defending: false, retaliated: false }
  };
  state.stacks.push(larva);
  state.turnQueue?.push(larva.id);
  return larva;
}

function livingStackOccupiesHex(state, grid, hexId) {
  return (state?.stacks || []).some((candidate) => (
    candidate.alive !== false
    && Number(candidate.count || 0) > 0
    && (footprintHexes(grid, candidate) || [candidate.hexId]).includes(hexId)
  ));
}

function restoreStackHp(state, target, restoredHp) {
  const hpPerUnit = Math.max(1, Number(target.creature.stats.hp || 1));
  target.hpTotal = Math.min(maxStackHp(target), Number(target.hpTotal || 0) + restoredHp);
  target.count = Math.ceil(target.hpTotal / hpPerUnit);
  target.wound = target.count * hpPerUnit - target.hpTotal;
  target.alive = target.hpTotal > 0;
  target.statuses ||= {};
  target.statuses.acted = false;
  if (target.alive) removeCorpseForStack(state, target.id);
}

function restorationValue(target, restoredHp) {
  const hp = Math.max(1, Number(target?.creature?.stats?.hp || 1));
  const unitValue = Number(target?.creature?.stats?.aiValue ?? target?.creature?.stats?.fightValue ?? hp);
  return (Math.max(0, restoredHp) / hp) * unitValue;
}

function advanceAfterCreatureAction(state) {
  if (!state) return;
  const playerAlive = (state.stacks || []).some((stack) => stack.owner === "player" && stack.alive !== false && stack.count > 0);
  const aiAlive = (state.stacks || []).some((stack) => stack.owner === "ai" && stack.alive !== false && stack.count > 0);
  if (!playerAlive || !aiAlive) {
    state.phase = "finished";
    state.winner = playerAlive ? "player" : aiAlive ? "ai" : "draw";
    state.activeStackId = null;
    state.selectedStackId = null;
    state.actionLog?.unshift(state.winner === "draw" ? "Battle ends in a draw." : `${state.winner.toUpperCase()} wins the battle.`);
    return;
  }
  state.activeStackId = nextActiveStack(state);
  state.selectedStackId = state.activeStackId;
}

function heatStrokeHexes(grid, stack, attackDirection) {
  const footprint = footprintHexes(grid, stack) || [];
  if (!footprint.length) return [];
  const origin = footprint[0];
  const paths = ["L", "LL", "FL", "FF", "RF", "RR", "R"];
  const affected = new Set();
  for (const path of paths) {
    let current = origin;
    const firstStep = hexInRelativeDirection(grid, current, attackDirection, path[0]);
    if (footprint.length > 1 && footprint.includes(firstStep)) {
      current = hexInDirection(grid, current, attackDirection) ?? current;
    }
    for (const step of path) {
      current = hexInRelativeDirection(grid, current, attackDirection, step);
      if (current === null) break;
    }
    if (current !== null && !footprint.includes(current)) affected.add(current);
  }
  return [...affected];
}

function stackAttackDirection(grid, attacker, defender) {
  const attackerHexes = footprintHexes(grid, attacker) || [attacker.hexId];
  const defenderHexes = new Set(footprintHexes(grid, defender) || [defender.hexId]);
  for (const attackerHexId of attackerHexes) {
    const origin = grid.hexes.find((hex) => hex.id === attackerHexId);
    const targetHexId = origin?.neighbors.find((neighbor) => defenderHexes.has(neighbor));
    if (targetHexId !== undefined) return directionBetween(grid, attackerHexId, targetHexId);
  }
  return directionBetween(grid, attacker.hexId, defender.hexId);
}

function hexInRelativeDirection(grid, hexId, attackDirection, relative) {
  const offset = relative === "F" ? 0 : relative === "R" ? 1 : relative === "B" ? 3 : -1;
  return hexInDirection(grid, hexId, (attackDirection + offset + 6) % 6);
}

function hexInDirection(grid, hexId, direction) {
  const origin = grid.hexes.find((hex) => hex.id === hexId);
  if (!origin) return null;
  let best = null;
  for (const neighborId of origin.neighbors) {
    const neighbor = grid.hexes.find((hex) => hex.id === neighborId);
    if (!neighbor) continue;
    const candidateDirection = directionFromVector(neighbor.centerX - origin.centerX, neighbor.centerY - origin.centerY);
    if (candidateDirection === direction) return neighborId;
    const distance = circularDirectionDistance(candidateDirection, direction);
    if (!best || distance < best.distance) best = { id: neighborId, distance };
  }
  return best?.distance === 0 ? best.id : null;
}

function directionBetween(grid, fromHexId, toHexId) {
  const from = grid.hexes.find((hex) => hex.id === fromHexId);
  const to = grid.hexes.find((hex) => hex.id === toHexId);
  if (!from || !to) return 2;
  return directionFromVector(to.centerX - from.centerX, to.centerY - from.centerY);
}

function directionFromVector(dx, dy) {
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const centers = [242, 298, 0, 62, 118, 180];
  let best = 0;
  for (let index = 1; index < centers.length; index += 1) {
    if (angleDistance(angle, centers[index]) < angleDistance(angle, centers[best])) best = index;
  }
  return best;
}

function angleDistance(left, right) {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

function circularDirectionDistance(left, right) {
  const difference = Math.abs(left - right) % 6;
  return Math.min(difference, 6 - difference);
}

function maxStackHp(stack) {
  return Math.max(0, Number(stack.initialCount ?? stack.count ?? 0) * Number(stack.creature.stats.hp || 1));
}

function missingStackHp(stack) {
  return Math.max(0, maxStackHp(stack) - Number(stack.hpTotal || 0));
}
