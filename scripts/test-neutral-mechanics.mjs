import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inferAbilityFlags } from "../src/engine/abilities.js";
import { chooseBestAttack, executeAttack } from "../src/engine/combat.js";
import { calculateRolledDamage } from "../src/engine/combatPower.js";
import { beginNeutralStackTurn, friendlyLuckChanceMultiplier } from "../src/engine/neutralAbilities.js";
import { nextActiveStack } from "../src/engine/turnOrder.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const neutralData = JSON.parse(fs.readFileSync(path.join(root, "public/data/neutral-creatures.json"), "utf8"));
const creatures = new Map(neutralData.creatures.map((entry) => [entry.creatureId, entry]));
let sequence = 0;

function creature(creatureId, overrides = {}) {
  const registered = creatures.get(creatureId);
  return {
    creatureId,
    name: registered?.name || `Creature ${creatureId}`,
    abilities: registered?.abilities || [],
    stats: {
      attack: 0,
      defense: 0,
      minDamage: 1,
      maxDamage: 1,
      hp: 100,
      speed: 5,
      shots: 0,
      aiValue: 100,
      ...(registered?.stats || {}),
      ...overrides.stats
    }
  };
}

function stack(creatureValue, owner, hexId, count = 1) {
  sequence += 1;
  const hp = Number(creatureValue.stats.hp || 1);
  return {
    id: `neutral_test_${sequence}`,
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

function stateOf(stacks, active = null, rng = () => 0) {
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
    rng
  };
}

function lineGrid(length) {
  return {
    hexes: Array.from({ length }, (_, id) => ({
      id,
      row: 0,
      col: id,
      centerX: id * 44,
      centerY: 0,
      neighbors: [id - 1, id + 1].filter((value) => value >= 0 && value < length)
    }))
  };
}

// Every neutral is registered and combat-relevant passive flags are deterministic.
assert.equal(creatures.size, 18);
assert.deepEqual([...creatures.keys()], [116, 117, 132, 133, 134, 135, 136, 137, 139, 140, 141, 142, 143, 144, 167, 168, 169, 170]);
assert.equal(inferAbilityFlags(creature(132)).fearAura, 0.1);
assert.equal(inferAbilityFlags(creature(135)).acidBreath, true);
assert.equal(inferAbilityFlags(creature(137)).noRangePenalty, true);
assert.equal(inferAbilityFlags(creature(168)).retaliationLimit, Infinity);
assert.equal(inferAbilityFlags(creature(170)).nonLiving, true);

// Spellcasting remains descriptive data only until the spell system exists.
const spellAbilityKeys = neutralData.creatures.flatMap((entry) => entry.abilities || [])
  .filter((ability) => ability.key === "spellcaster" || ability.key === "spellAfterAttack");
assert.ok(spellAbilityKeys.length >= 5);
assert.ok(spellAbilityKeys.every((ability) => /name|spell|cast/i.test(ability.details)));

// Troll regeneration repairs the wounded top unit but never resurrects a lost unit.
const troll = stack(creature(144), "player", 0, 3);
troll.hpTotal -= 37;
troll.wound = 37;
const trollState = stateOf([troll]);
assert.equal(beginNeutralStackTurn(trollState, troll).regeneratedHp, 37);
assert.equal(troll.wound, 0);
assert.equal(troll.count, 3);

// Azure Dragon fear skips living enemies, while non-living stacks are immune.
const azure = stack(creature(132, { stats: { speed: 5 } }), "ai", 1);
const livingTarget = stack(creature(999, { stats: { speed: 10 } }), "player", 0);
const fearState = stateOf([livingTarget, azure], null, () => 0);
assert.equal(nextActiveStack(fearState), azure.id);
assert.equal(livingTarget.statuses.acted, true);
assert.match(fearState.actionLog[0], /fear/i);
const goldGolem = stack(creature(116), "player", 0);
assert.equal(beginNeutralStackTurn(stateOf([goldGolem, azure], null, () => 0), goldGolem).skipped, false);

// Leprechauns double the trigger chance of an allied positive-Luck stack.
const luckyHalfling = stack({ ...creature(138), abilities: [{ key: "positiveLuck", details: "Positive luck" }] }, "player", 0);
const defender = stack(creature(998), "ai", 1);
const leprechaun = stack(creature(169), "player", 2);
assert.equal(friendlyLuckChanceMultiplier(stateOf([luckyHalfling, defender]), "player"), 1);
assert.equal(friendlyLuckChanceMultiplier(stateOf([luckyHalfling, leprechaun, defender]), "player"), 2);
const noAuraRng = [0, 0.06];
const withAuraRng = [0, 0.06];
assert.equal(calculateRolledDamage(luckyHalfling, defender, stateOf([luckyHalfling, defender]), {
  mode: "melee",
  rng: () => noAuraRng.shift()
}).luckyStrike, false);
assert.equal(calculateRolledDamage(luckyHalfling, defender, stateOf([luckyHalfling, leprechaun, defender]), {
  mode: "melee",
  rng: () => withAuraRng.shift()
}).luckyStrike, true);

// Rust Dragon applies permanent Defense erosion and the audited 30% acid proc.
const meleeGrid = lineGrid(4);
const rust = stack(creature(135, { stats: { minDamage: 10, maxDamage: 10, speed: 10 } }), "player", 1, 2);
const acidTarget = stack(creature(997, { stats: { hp: 1000, speed: 1 } }), "ai", 2);
const acidState = stateOf([rust, acidTarget], rust, () => 0);
const acidResult = executeAttack(acidState, meleeGrid, rust, acidTarget);
assert.equal(acidTarget.acidDefensePenalty, 3);
assert.equal(acidResult.splashLog.some((entry) => entry.acidBreath && entry.damage === 50), true);

// Sharpshooter ignores the normal half-damage penalty beyond ten hexes.
const rangedGrid = lineGrid(12);
const sharpshooter = stack(creature(137, { stats: { attack: 0, minDamage: 10, maxDamage: 10, shots: 32 } }), "player", 0);
const ordinaryShooter = stack(creature(996, { stats: { attack: 0, minDamage: 10, maxDamage: 10, shots: 32 } }), "player", 0);
const distantTarget = stack(creature(995, { stats: { defense: 0, hp: 1000 } }), "ai", 11);
const sharpshooterChoice = chooseBestAttack(rangedGrid, stateOf([sharpshooter, distantTarget]), sharpshooter);
const ordinaryChoice = chooseBestAttack(rangedGrid, stateOf([ordinaryShooter, distantTarget]), ordinaryShooter);
assert.ok(sharpshooterChoice.score > ordinaryChoice.score * 1.9);

console.log("Neutral mechanics tests passed.");
