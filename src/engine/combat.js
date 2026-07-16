import { inferAbilityFlags } from "./abilities.js";
import { calculateExpectedDamage, calculateHpLossValue, calculateRolledDamage, calculateTargetPriority } from "./combatPower.js";
import { findMovementPath, findPath, findStackPath } from "./movement.js";
import { canStackOccupy, stacksAreAdjacent } from "./footprint.js";
import {
  activateDetonation,
  activateTemporaryInvulnerability,
  breathSplashTarget,
  canUsePreemptiveShot,
  chooseBestCorpseDevour,
  chooseBestHeatStroke,
  chooseBestRepair,
  chooseBestResurrection,
  consumePreemptiveShot,
  executeCorpseDevour,
  executeHeatStroke,
  executeRepair,
  executeResurrection,
  resolveArmedFactoryAttack
} from "./creatureAbilities.js";
import { applyCombatDamage } from "./combatDamage.js";
import { factoryAbilityFor, isStackInvulnerable } from "./factoryAbilities.js";
import { distanceByBreadthFirst } from "./hexGrid.js";
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
  if (typeof a === "object" && typeof b === "object") return stacksAreAdjacent(grid, a, b);
  const hex = grid.hexes.find((candidate) => candidate.id === a);
  return Boolean(hex?.neighbors.includes(b));
}

export function canUseRangedAttack(attacker, grid, target, state = null) {
  const abilities = inferAbilityFlags(attacker.creature);
  const adjacentEnemy = state
    ? livingEnemies(state, attacker).some((enemy) => stacksAreAdjacent(grid, attacker, enemy))
    : stacksAreAdjacent(grid, attacker, target);
  return abilities.ranged && Number(attacker.shotsRemaining || 0) > 0 && !adjacentEnemy;
}

export function findApproachHex(grid, state, attacker, target) {
  return attackOption(grid, state, attacker, target).approachHex ?? null;
}

function findApproachOptions(grid, state, attacker, target) {
  const options = stacksAreAdjacent(grid, attacker, target)
    ? [{ hexId: attacker.hexId, path: [attacker.hexId] }]
    : [];
  for (const candidate of grid.hexes) {
    if (candidate.id === attacker.hexId) continue;
    if (!stacksAreAdjacent(grid, attacker, target, candidate.id)) continue;
    const path = findMovementPath(grid, state.stacks, attacker, candidate.id, state.obstacleBlockedHexIds);
    if (!path) continue;
    options.push({ hexId: candidate.id, path });
  }
  return options;
}

export function attackOptions(grid, state, attacker, target) {
  if (!attacker || !target || attacker.owner === target.owner || target.alive === false || isStackInvulnerable(target)) {
    return [];
  }
  if (canUseRangedAttack(attacker, grid, target, state)) {
    return [{ canAttack: true, mode: "ranged", approachHex: attacker.hexId, approachPath: [attacker.hexId] }];
  }
  return findApproachOptions(grid, state, attacker, target).map((approach) => ({
    canAttack: true,
    mode: "melee",
    approachHex: approach.hexId,
    approachPath: approach.path
  }));
}

export function attackOption(grid, state, attacker, target) {
  const options = attackOptions(grid, state, attacker, target);
  if (!options.length) return { canAttack: false, reason: "no_reachable_contact_hex" };
  return options.reduce((best, option) => {
    const score = scoreAttackOption(grid, attacker, target, option);
    if (!best || score > best.score || (score === best.score && option.approachHex > best.option.approachHex)) {
      return { option, score };
    }
    return best;
  }, null).option;
}

export function chooseBestAttack(grid, state, attacker) {
  let best = null;
  for (const target of livingEnemies(state, attacker)) {
    for (const option of attackOptions(grid, state, attacker, target)) {
      const score = scoreAttackOption(grid, attacker, target, option);
      if (!best || score > best.score || (score === best.score && (target.hexId > best.target.hexId || (target.hexId === best.target.hexId && option.approachHex > best.option.approachHex)))) {
        best = { target, option, score };
      }
    }
  }
  return best;
}

export function chooseAdvanceHex(grid, state, stack) {
  return chooseAdvanceOption(grid, state, stack).hexId;
}

export function chooseAdvanceOption(grid, state, stack) {
  const plan = choosePursuitPlan(grid, state, stack);
  if (!plan) return { hexId: stack.hexId, path: [stack.hexId], target: null, score: -Infinity, turnsToReach: Infinity };
  const speed = stack.heatStrokeActive ? 0 : Math.max(0, Number(stack.creature.stats.speed || 0));
  const stepIndex = Math.min(speed, plan.path.length - 1);
  const bestHex = plan.path[stepIndex];
  return {
    hexId: bestHex,
    path: plan.path.slice(0, stepIndex + 1),
    target: plan.target,
    score: plan.score,
    turnsToReach: plan.turnsToReach
  };
}

function choosePursuitPlan(grid, state, stack) {
  let best = null;
  const speed = Math.max(1, Number(stack.creature.stats.speed || 0));
  for (const target of livingEnemies(state, stack)) {
    if (isStackInvulnerable(target)) continue;
    for (const candidate of grid.hexes) {
      if (!canStackOccupy(grid, state.stacks, stack, candidate.id, state.obstacleBlockedHexIds)) continue;
      if (!stacksAreAdjacent(grid, stack, target, candidate.id)) continue;
      const movementAbilities = inferAbilityFlags(stack.creature);
      const path = movementAbilities.flying || movementAbilities.underground
        ? findPath(grid, stack.hexId, candidate.id)
        : findStackPath(grid, state.stacks, stack, stack.hexId, candidate.id, Infinity, state.obstacleBlockedHexIds);
      if (!path) continue;
      const movementSteps = Math.max(0, path.length - 1);
      const option = { canAttack: true, mode: "melee", approachHex: candidate.id, approachPath: path };
      const attackScore = scoreAttackOption(grid, stack, target, option);
      const turnsToReach = Math.ceil(movementSteps / speed);
      const score = attackScore / (1 + Math.max(0, turnsToReach - 1) * 0.35);
      if (!best || score > best.score || (score === best.score && movementSteps < best.movementSteps)) {
        best = { target, path, score, attackScore, turnsToReach, movementSteps };
      }
    }
  }
  return best;
}

export function executeAttack(state, grid, attacker, target, option = attackOption(grid, state, attacker, target)) {
  if (!option.canAttack || isStackInvulnerable(target)) {
    state.actionLog.unshift(`${attacker.label} cannot attack ${target.label}.`);
    return { ok: false, reason: isStackInvulnerable(target) ? "target_invulnerable" : option.reason };
  }

  const moved = option.approachHex !== attacker.hexId;
  const movementSteps = Math.max(0, Number(option.approachPath?.length || 1) - 1);
  if (moved) attacker.hexId = option.approachHex;

  const mode = option.mode === "ranged" ? "ranged" : "melee";
  const abilities = inferAbilityFlags(attacker.creature);
  const rangePenalty = mode === "ranged" && !abilities.noRangePenalty && distanceByBreadthFirst(grid, attacker.hexId, target.hexId) > 10 ? 0.5 : 1;
  attacker.suppressRetaliationThisAttack = Boolean(attacker.heatStrokeActive || attacker.detonationActive);
  const requestedStrikes = abilities.doubleAttack ? 2 : 1;
  const strikes = mode === "ranged" ? Math.min(requestedStrikes, Math.max(1, Number(attacker.shotsRemaining || 0))) : requestedStrikes;

  attacker.statuses.defending = false;
  const attackLog = [];
  const splashLog = [];
  let retaliation = null;
  let preemptive = null;

  const preemptiveContext = { incomingMode: mode, grid, state };
  if (canUsePreemptiveShot(target, preemptiveContext)) {
    consumePreemptiveShot(target, preemptiveContext);
    const preemptiveRangePenalty = distanceByBreadthFirst(grid, target.hexId, attacker.hexId) > 10 ? 0.5 : 1;
    const preemptiveDamage = calculateRolledDamage(target, attacker, state, {
      mode: "ranged",
      rangePenalty: preemptiveRangePenalty,
      rng: state.rng
    }).damage;
    const preemptiveResult = applyCombatDamage(state, grid, attacker, preemptiveDamage, {
      source: target,
      kind: "preemptive_shot"
    });
    target.statuses.retaliated = true;
    target.retaliationsUsed = Number(target.retaliationsUsed || 0) + 1;
    preemptive = {
      attacker: target.id,
      target: attacker.id,
      damage: preemptiveResult.damage,
      before: preemptiveResult.before,
      after: preemptiveResult.after
    };
  }

  if (attacker.alive === false) {
    attacker.statuses.acted = true;
    state.actionLog.unshift(`${target.label} fires first for ${preemptive?.damage || 0}; ${attacker.label}'s attack is cancelled.`);
    finishAction(state);
    return { ok: true, mode, moved, attackLog, splashLog, retaliation, preemptive, cancelledByPreemptive: true };
  }

  if (mode === "ranged") attacker.shotsRemaining = Math.max(0, Number(attacker.shotsRemaining || 0) - strikes);

  for (let strike = 1; strike <= strikes; strike += 1) {
    if (attacker.alive === false || target.alive === false) break;
    const damage = calculateRolledDamage(attacker, target, state, { mode, movementSteps, rangePenalty, rng: state.rng }).damage;
    const result = applyCombatDamage(state, grid, target, damage, { source: attacker, kind: mode });
    attackLog.push({
      strike,
      attacker: attacker.id,
      target: target.id,
      damage: result.damage,
      before: result.before,
      after: result.after
    });

    if (abilities.acidBreath) {
      target.acidDefensePenalty = Number(target.acidDefensePenalty || 0) + 3;
      const rng = typeof state.rng === "function" ? state.rng : Math.random;
      if (target.alive !== false && rng() < 0.3) {
        const acid = applyCombatDamage(state, grid, target, 25 * Math.max(1, Number(attacker.count || 1)), {
          source: attacker,
          kind: "acid_breath"
        });
        splashLog.push({ attacker: attacker.id, target: target.id, damage: acid.damage, acidBreath: true });
      }
    }

    if (abilities.breathAttack) {
      const splashTarget = breathSplashTarget(grid, state, attacker, target, option);
      if (splashTarget) {
        const splashDamage = calculateRolledDamage(attacker, splashTarget, state, {
          mode: "melee",
          movementSteps,
          rng: state.rng
        }).damage;
        const splashResult = applyCombatDamage(state, grid, splashTarget, splashDamage, {
          source: attacker,
          kind: "breath_splash"
        });
        splashLog.push({
          strike,
          attacker: attacker.id,
          target: splashTarget.id,
          damage: splashResult.damage,
          before: splashResult.before,
          after: splashResult.after
        });
      }
    }

    if (strike === 1 && (attacker.heatStrokeActive || attacker.detonationActive)) {
      splashLog.push(...resolveArmedFactoryAttack(state, grid, attacker, target));
    }

    if (attacker.alive === false) break;

    if (strike === 1 && mode === "melee" && target.alive !== false && canRetaliate(target, attacker)) {
      const retaliationDamage = calculateRolledDamage(target, attacker, state, { mode: "melee", movementSteps: 0, rng: state.rng }).damage;
      const retaliationResult = applyCombatDamage(state, grid, attacker, retaliationDamage, {
        source: target,
        kind: "retaliation"
      });
      target.statuses.retaliated = true;
      target.retaliationsUsed = Number(target.retaliationsUsed || 0) + 1;
      retaliation = {
        attacker: target.id,
        target: attacker.id,
        damage: retaliationResult.damage,
        before: retaliationResult.before,
        after: retaliationResult.after
      };
    }
  }

  attacker.statuses.acted = true;
  attacker.suppressRetaliationThisAttack = false;
  const actionText = describeAttack(attacker, target, mode, moved, attackLog, retaliation, preemptive, splashLog);
  state.actionLog.unshift(actionText);
  finishAction(state);
  return { ok: true, mode, moved, attackLog, splashLog, retaliation, preemptive };
}

export async function performAiTurn(state, grid, hooks = {}) {
  const stack = state.stacks.find((candidate) => candidate.id === state.activeStackId);
  if (!stack || stack.owner !== "ai" || stack.alive === false) return;

  const attack = chooseBestAttack(grid, state, stack);
  const factoryAbility = factoryAbilityFor(stack);
  if (
    factoryAbility?.detonation
    && !stack.detonationActive
    && !stack.detonationResolved
    && attack
    && detonationValue(grid, state, stack, attack.target) > 0
  ) {
    await hooks.beforeAbility?.(stack, attack.target, "detonation");
    activateDetonation(state, stack);
    return;
  }
  if (
    factoryAbility?.temporaryInvulnerability
    && Number(stack.invulnerabilityUsesRemaining || 0) > 0
    && !stack.invulnerable
    && (
      factoryAbility.temporaryInvulnerability.activationConsumesTurn === false
      || Number(stack.hpTotal || 0) <= Number(stack.initialCount || stack.count || 0) * Number(stack.creature.stats.hp || 1) * 0.5
    )
  ) {
    await hooks.beforeAbility?.(stack, stack, "meditation");
    activateTemporaryInvulnerability(state, stack);
    return;
  }
  const resurrection = chooseBestResurrection(state, stack);
  const repair = chooseBestRepair(state, stack, grid);
  const heatStroke = chooseBestHeatStroke(grid, state, stack);
  const corpseDevour = chooseBestCorpseDevour(state, grid, stack);
  const attackScore = attack?.score ?? -Infinity;
  const special = [
    resurrection && { kind: "resurrection", score: resurrection.score, choice: resurrection },
    repair && { kind: "repair", score: repair.score, choice: repair },
    heatStroke && heatStroke.score > 0 && { kind: "heat_stroke", score: heatStroke.score, choice: heatStroke },
    corpseDevour && !attack && { kind: "corpse_devour", score: corpseDevour.score, choice: corpseDevour }
  ].filter(Boolean).reduce((best, candidate) => (!best || candidate.score > best.score ? candidate : best), null);
  if (special?.score > attackScore && special.kind === "resurrection") {
    await hooks.beforeAbility?.(stack, resurrection.target, "resurrection");
    executeResurrection(state, stack, resurrection.target);
    return;
  }
  if (special?.score > attackScore && special.kind === "repair") {
    await hooks.beforeAbility?.(stack, repair.target, "repair");
    executeRepair(state, stack, repair.target, { grid, approachHex: repair.approachHex });
    return;
  }
  if (special?.score > attackScore && special.kind === "heat_stroke") {
    await hooks.beforeAbility?.(stack, heatStroke.targets, "heat_stroke");
    executeHeatStroke(state, grid, stack, heatStroke);
    return;
  }
  if (special?.kind === "corpse_devour") {
    await hooks.beforeAbility?.(stack, corpseDevour.corpse, "corpse_devour");
    executeCorpseDevour(state, grid, stack, corpseDevour.destinationHexId);
    return;
  }
  const advance = chooseAdvanceOption(grid, state, stack);
  if (attack && (attack.option.mode === "ranged" || !(advance.hexId !== stack.hexId && advance.score > attack.score))) {
    await hooks.beforeAttack?.(stack, attack.target, attack.option);
    const result = executeAttack(state, grid, stack, attack.target, attack.option);
    await hooks.afterAttack?.(stack, attack.target, result, attack.option);
    return;
  }

  if (advance.hexId !== stack.hexId) {
    await hooks.beforeMove?.(stack, advance.hexId, advance.path);
    stack.hexId = advance.hexId;
    stack.statuses.acted = true;
    state.actionLog.unshift(`${stack.label} advances to hex ${advance.hexId}.`);
    finishAction(state);
    return;
  }

  await hooks.beforeDefend?.(stack);
  stack.statuses.defending = true;
  stack.defenseBonus = Math.max(1, Math.floor(Number(stack.creature.stats.defense || 0) * 0.2));
  stack.statuses.acted = true;
  state.actionLog.unshift(`${stack.label} defends.`);
  finishAction(state);
}

function detonationValue(grid, state, stack, primaryTarget) {
  const damage = 40 * Math.max(1, Number(stack.count || 1));
  const targetHexes = footprintHexes(grid, primaryTarget) || [primaryTarget.hexId];
  let value = -calculateHpLossValue(stack, Number(stack.hpTotal || 0)).value;
  for (const target of state.stacks || []) {
    if (target.id === stack.id || target.alive === false || isStackInvulnerable(target)) continue;
    const inRange = (footprintHexes(grid, target) || [target.hexId]).some((hexId) => (
      targetHexes.some((origin) => distanceByBreadthFirst(grid, origin, hexId) <= 2)
    ));
    if (!inRange) continue;
    const loss = calculateHpLossValue(target, damage).value;
    value += target.owner === stack.owner ? -loss : loss;
  }
  return value;
}

function scoreAttackOption(grid, attacker, target, option) {
  if (option.mode === "ranged") {
    const rangePenalty = !inferAbilityFlags(attacker.creature).noRangePenalty && distanceByBreadthFirst(grid, attacker.hexId, target.hexId) > 10 ? 0.5 : 1;
    const damage = calculateExpectedDamage(attacker, target, null, { mode: "ranged", rangePenalty }).damage;
    return calculateHpLossValue(target, damage).value;
  }
  const exchange = calculateTargetPriority(attacker, target, null, {
    mode: "melee",
    movementSteps: Math.max(0, Number(option.approachPath?.length || 1) - 1)
  });
  const movePenalty = Math.max(0, Number(option.approachPath?.length || 1) - 1) * 5;
  return exchange.score - movePenalty;
}

function canRetaliate(defender, attacker) {
  if (attacker?.suppressRetaliationThisAttack || attacker?.heatStrokeActive || attacker?.detonationActive) return false;
  const attackerAbilities = inferAbilityFlags(attacker.creature);
  if (attackerAbilities.noRetaliation) return false;
  const defenderAbilities = inferAbilityFlags(defender.creature);
  const limit = defenderAbilities.retaliationLimit ?? 1;
  if (Number(defender.retaliationsUsed || 0) >= limit) return false;
  return defender.alive !== false && defender.count > 0;
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

function describeAttack(attacker, target, mode, moved, attackLog, retaliation, preemptive, splashLog) {
  const totalDamage = attackLog.reduce((sum, entry) => sum + entry.damage, 0);
  const splashDamage = splashLog.reduce((sum, entry) => sum + entry.damage, 0);
  const movement = moved ? "moves and " : "";
  const targetState = target.alive === false ? "target killed" : `${target.count} left`;
  const preemptiveText = preemptive ? ` Preemptive shot: ${preemptive.damage}.` : "";
  const splashText = splashDamage ? ` Breath splash: ${splashDamage}.` : "";
  const retaliationText = retaliation ? ` Retaliation: ${retaliation.damage}.` : "";
  return `${attacker.label} ${movement}${mode === "ranged" ? "shoots" : "attacks"} ${target.label} for ${totalDamage}. ${targetState}.${preemptiveText}${splashText}${retaliationText}`;
}
