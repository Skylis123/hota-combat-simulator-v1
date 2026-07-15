import assert from "node:assert/strict";
import { inferAbilityFlags } from "../src/engine/abilities.js";
import { startBattle } from "../src/engine/battleState.js";
import { applyCombatDamage } from "../src/engine/combatDamage.js";
import { executeAttack, attackOptions, chooseAdvanceOption } from "../src/engine/combat.js";
import { applyStatusModifiersToEvaluation, calculateExpectedDamage, calculateRolledDamage } from "../src/engine/combatPower.js";
import {
  activateDetonation,
  activateTemporaryInvulnerability,
  executeCorpseDevour,
  executeHeatStroke,
  executeRepair,
  chooseBestHeatStroke,
  heatStrokeOptions,
  repairCandidates,
  resurrectionCandidates
} from "../src/engine/creatureAbilities.js";
import {
  FACTORY_AUDITED_COMBAT_CONFIG,
  FACTORY_CREATURE_IDS,
  resetFactoryRoundState
} from "../src/engine/factoryAbilities.js";
import { findMovementPath } from "../src/engine/movement.js";
import { nextActiveStack } from "../src/engine/turnOrder.js";

let sequence = 0;

function creature(creatureId, overrides = {}) {
  return {
    creatureId,
    name: overrides.name || `Creature ${creatureId}`,
    stats: {
      attack: 0,
      defense: 0,
      minDamage: 1,
      maxDamage: 1,
      hp: 10,
      speed: 6,
      shots: 0,
      aiValue: 100,
      ...overrides.stats
    }
  };
}

function stack(creatureValue, owner, hexId, count = 1) {
  sequence += 1;
  const hp = Number(creatureValue.stats.hp || 1);
  return {
    id: `test_stack_${sequence}`,
    creature: creatureValue,
    owner,
    label: `${owner} ${creatureValue.name}`,
    hexId,
    count,
    initialCount: count,
    hpTotal: count * hp,
    wound: 0,
    effects: [],
    shotsRemaining: Number(creatureValue.stats.shots || 0),
    maxShots: Number(creatureValue.stats.shots || 0),
    retaliationsUsed: 0,
    defenseBonus: 0,
    alive: true,
    createdAt: sequence,
    statuses: { acted: false, waiting: false, defending: false, retaliated: false }
  };
}

function stateOf(stacks, active = stacks[0]) {
  return {
    phase: "battle",
    stacks,
    corpses: [],
    actionLog: [],
    round: 1,
    turnQueue: stacks.map((entry) => entry.id),
    activeStackId: active?.id || null,
    selectedStackId: active?.id || null,
    lastMovedOwner: null,
    obstacleBlockedHexIds: new Set(),
    rng: () => 0
  };
}

function rectangularHexGrid(rows = 7, cols = 7) {
  const hexes = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      hexes.push({
        id: row * cols + col,
        row,
        col,
        centerX: col * 44 + (row % 2 === 0 ? 22 : 0),
        centerY: row * 42,
        neighbors: []
      });
    }
  }
  const byPosition = new Map(hexes.map((hex) => [`${hex.row}:${hex.col}`, hex]));
  for (const hex of hexes) {
    const diagonalCols = hex.row % 2 === 0 ? [hex.col, hex.col + 1] : [hex.col - 1, hex.col];
    const positions = [
      [hex.row, hex.col - 1], [hex.row, hex.col + 1],
      [hex.row - 1, diagonalCols[0]], [hex.row - 1, diagonalCols[1]],
      [hex.row + 1, diagonalCols[0]], [hex.row + 1, diagonalCols[1]]
    ];
    hex.neighbors = positions.map(([row, col]) => byPosition.get(`${row}:${col}`)?.id).filter((id) => id !== undefined);
  }
  return { hexes };
}

const grid = rectangularHexGrid();
const at = (row, col) => row * 7 + col;

// Registry flags and the Grenadier's confirmed 20% ranged Defense penetration.
const grenadier = creature(FACTORY_CREATURE_IDS.HALFLING_GRENADIER, {
  stats: { minDamage: 100, maxDamage: 100, shots: 24 }
});
assert.equal(inferAbilityFlags(grenadier).positiveLuck, true);
assert.equal(inferAbilityFlags(grenadier).rangedDefenseIgnore, 0.2);
const defended = stack(creature(999, { stats: { defense: 10, hp: 1000 } }), "ai", at(3, 5));
assert.equal(calculateExpectedDamage(stack(grenadier, "player", at(3, 1)), defended, null, { mode: "ranged" }).damage, 83);
const luckyGrenadier = stack(grenadier, "player", at(3, 1));
const luckyDamage = calculateRolledDamage(luckyGrenadier, defended, null, { mode: "ranged", rng: () => 0 });
assert.equal(luckyDamage.luckyStrike, true);
assert.equal(luckyDamage.damage, 160);

// Underground movement ignores intervening stacks while retaining legal landing checks.
const lineGrid = {
  hexes: Array.from({ length: 6 }, (_, id) => ({
    id, row: 0, col: id, centerX: id * 44, centerY: 0,
    neighbors: [id - 1, id + 1].filter((value) => value >= 0 && value < 6)
  }))
};
const worm = stack(creature(FACTORY_CREATURE_IDS.SANDWORM, { stats: { speed: 6 } }), "player", 1);
const armadillo = stack(creature(FACTORY_CREATURE_IDS.ARMADILLO, { stats: { speed: 6 } }), "player", 1);
const blocker = stack(creature(999), "ai", 2);
assert.deepEqual(findMovementPath(lineGrid, [worm, blocker], worm, 5), [1, 2, 3, 4, 5]);
assert.equal(findMovementPath(lineGrid, [armadillo, blocker], armadillo, 5), null);

// Sandworms and mechanical Factory units ignore their confirmed ineligible statuses.
worm.effects = [{ type: "blind" }, { type: "stone" }];
assert.equal(applyStatusModifiersToEvaluation(worm).actionDenied, false);
const automatonStatus = stack(creature(FACTORY_CREATURE_IDS.AUTOMATON), "player", at(3, 3));
automatonStatus.effects = [{ type: "blind" }];
assert.equal(applyStatusModifiersToEvaluation(automatonStatus).actionDenied, false);

// Repair is one-use, restores from scrap, and ordinary Resurrection rejects mechanical targets.
const mechanic = stack(creature(FACTORY_CREATURE_IDS.MECHANIC), "player", at(3, 2), 3);
const repairTarget = stack(creature(FACTORY_CREATURE_IDS.AUTOMATON, { stats: { hp: 30 } }), "player", at(3, 4), 5);
repairTarget.count = 0;
repairTarget.hpTotal = 0;
repairTarget.alive = false;
repairTarget.effects = [{ type: "slow", negative: true }, { type: "haste", positive: true }];
const repairState = stateOf([mechanic, repairTarget]);
repairState.corpses.push({ id: "repair-corpse", stackId: repairTarget.id, hexId: repairTarget.hexId, hexIds: [repairTarget.hexId], consumed: false });
assert.equal(repairCandidates(repairState, mechanic).length, 1);
assert.equal(executeRepair(repairState, mechanic, repairTarget).restoredHp, 30);
assert.equal(repairTarget.count, 1);
assert.equal(mechanic.repairUsesRemaining, 0);
assert.deepEqual(repairTarget.effects, [{ type: "haste", positive: true }]);
const archangel = stack(creature(13), "player", at(2, 2));
archangel.creature.stats.hp = 250;
assert.equal(resurrectionCandidates(stateOf([archangel, repairTarget]), archangel).length, 0);

// Ignition is free, triggers only after the next attack, then disintegrates the Automaton.
const detonator = stack(creature(FACTORY_CREATURE_IDS.AUTOMATON, { stats: { hp: 30 } }), "player", at(3, 3), 2);
const blastVictim = stack(creature(999, { stats: { hp: 20 } }), "ai", at(2, 3), 2);
const blastState = stateOf([detonator, blastVictim]);
assert.equal(FACTORY_AUDITED_COMBAT_CONFIG.detonation.confidence, "CONFIG_DERIVED");
assert.equal(activateDetonation(blastState, detonator).consumesTurn, false);
applyCombatDamage(blastState, grid, detonator, 1, { kind: "test" });
assert.equal(blastVictim.hpTotal, 40);
executeAttack(blastState, grid, detonator, blastVictim);
assert.equal(detonator.alive, false);
assert.equal(blastVictim.alive, false);
assert.equal(blastState.corpses.some((corpse) => corpse.stackId === detonator.id), true);

// Breath attacks continue through the primary target and can damage an ally behind it.
const breathingMechanic = stack(creature(FACTORY_CREATURE_IDS.MECHANIC, { stats: { minDamage: 10, maxDamage: 10 } }), "player", at(3, 2));
const breathPrimary = stack(creature(998, { stats: { hp: 100 } }), "ai", at(3, 3));
const breathAlly = stack(creature(997, { stats: { hp: 100 } }), "player", at(3, 4));
const breathState = stateOf([breathingMechanic, breathPrimary, breathAlly]);
const breathResult = executeAttack(breathState, grid, breathingMechanic, breathPrimary);
assert.equal(breathResult.splashLog.length, 1);
assert.equal(breathAlly.hpTotal, 90);

// Preemptive shot resolves before the incoming attack and resets per round.
const fragileAttacker = stack(creature(996, { stats: { minDamage: 50, maxDamage: 50, hp: 4, shots: 10 } }), "player", at(3, 1));
const gunslinger = stack(creature(FACTORY_CREATURE_IDS.GUNSLINGER, { stats: { minDamage: 5, maxDamage: 5, shots: 16 } }), "ai", at(3, 5));
const preemptiveState = stateOf([fragileAttacker, gunslinger]);
const preemptiveResult = executeAttack(preemptiveState, grid, fragileAttacker, gunslinger);
assert.equal(preemptiveResult.cancelledByPreemptive, true);
assert.equal(gunslinger.shotsRemaining, 15);
assert.equal(gunslinger.preemptiveShotsUsedThisRound, 1);
resetFactoryRoundState(gunslinger);
assert.equal(gunslinger.preemptiveShotsUsedThisRound, 0);

// Couatl protection blocks direct and area targeting until its next own turn.
const couatl = stack(creature(FACTORY_CREATURE_IDS.COUATL), "player", at(3, 3));
const couatlEnemy = stack(creature(995), "ai", at(3, 5));
const couatlState = stateOf([couatl, couatlEnemy]);
assert.equal(activateTemporaryInvulnerability(couatlState, couatl).consumesTurn, true);
assert.equal(attackOptions(grid, couatlState, couatlEnemy, couatl).length, 0);
couatl.effects = [{ type: "slow", negative: true }];
assert.equal(applyStatusModifiersToEvaluation(couatl).speed, couatl.creature.stats.speed);
couatlEnemy.statuses.acted = true;
couatlState.activeStackId = couatlEnemy.id;
assert.equal(nextActiveStack(couatlState), couatl.id);
assert.equal(couatl.invulnerable, false);
const crimson = stack(creature(FACTORY_CREATURE_IDS.CRIMSON_COUATL), "player", at(2, 2));
const crimsonState = stateOf([crimson, stack(creature(994), "ai", at(2, 5))]);
assert.equal(activateTemporaryInvulnerability(crimsonState, crimson).consumesTurn, false);
assert.equal(crimson.statuses.acted, false);

// Devour Corpses consumes corpses and creates a temporary, summon-only Larva stack.
const olgoi = stack(creature(FACTORY_CREATURE_IDS.OLGOI_KHORKHOI), "player", at(3, 1));
const olgoiEnemy = stack(creature(993, { stats: { hp: 20 } }), "ai", at(3, 5));
const devourState = stateOf([olgoi, olgoiEnemy]);
devourState.corpses = [
  { id: "corpse-a", stackId: "fallen-a", hexId: at(3, 4), hexIds: [at(3, 4)], consumed: false },
  { id: "corpse-b", stackId: "fallen-b", hexId: at(3, 3), hexIds: [at(3, 3)], consumed: false }
];
const devour = executeCorpseDevour(devourState, grid, olgoi, at(3, 4));
assert.equal(devour.larva.temporarySummon, true);
assert.equal(devour.larva.creature.summonOnly, true);
assert.equal(devourState.stacks.includes(devour.larva), true);
assert.equal(devour.larvaCount, 1);
assert.equal(olgoi.hexId, at(3, 1));
assert.equal(olgoi.corpseDevourUsesRemaining, 49);

// Heat Stroke is free, roots/arms the stack, and resolves on its next normal attack.
const dreadnought = stack(creature(FACTORY_CREATURE_IDS.DREADNOUGHT, { stats: { minDamage: 10, maxDamage: 10, hp: 200 } }), "player", at(3, 3));
const heatEnemy = stack(creature(992, { stats: { hp: 100 } }), "ai", at(3, 4));
const heatAlly = stack(creature(991, { stats: { hp: 100 } }), "player", at(2, 4));
const heatState = stateOf([dreadnought, heatEnemy, heatAlly]);
startBattle(heatState);
const heatActivation = executeHeatStroke(heatState, grid, dreadnought);
assert.equal(heatActivation.consumesTurn, false);
assert.equal(dreadnought.heatStrokeActive, true);
assert.equal(dreadnought.heatStrokeUsesRemaining, 98);
assert.equal(dreadnought.statuses.acted, false);
assert.deepEqual(findMovementPath(grid, heatState.stacks, dreadnought, at(3, 2)), null);
assert.equal(chooseAdvanceOption(grid, heatState, dreadnought).hexId, dreadnought.hexId);
assert.equal(chooseBestHeatStroke(grid, heatState, dreadnought), null);
const heatResult = executeAttack(heatState, grid, dreadnought, heatEnemy);
assert.equal(heatResult.retaliation, null);
assert.equal(heatEnemy.hpTotal, 90);
assert.equal(heatAlly.hpTotal, 90);
assert.equal(dreadnought.heatStrokeActive, false);

console.log("Factory mechanics tests passed.");
