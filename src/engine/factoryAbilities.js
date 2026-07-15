export const FACTORY_CREATURE_IDS = Object.freeze({
  SANDWORM_LARVA: 10001,
  HALFLING: 138,
  HALFLING_GRENADIER: 171,
  MECHANIC: 172,
  ENGINEER: 173,
  ARMADILLO: 174,
  BELLWETHER_ARMADILLO: 175,
  AUTOMATON: 176,
  SENTINEL_AUTOMATON: 177,
  SANDWORM: 178,
  OLGOI_KHORKHOI: 179,
  GUNSLINGER: 180,
  BOUNTY_HUNTER: 181,
  COUATL: 182,
  CRIMSON_COUATL: 183,
  DREADNOUGHT: 184,
  JUGGERNAUT: 185
});

export const FACTORY_REPAIR_TARGET_IDS = Object.freeze([
  FACTORY_CREATURE_IDS.AUTOMATON,
  FACTORY_CREATURE_IDS.SENTINEL_AUTOMATON,
  FACTORY_CREATURE_IDS.DREADNOUGHT,
  FACTORY_CREATURE_IDS.JUGGERNAUT
]);

// Values below are derived from the local Factory spell/creature configs and
// the VCMI spell/damage implementation kept in this workspace.
export const FACTORY_AUDITED_COMBAT_CONFIG = Object.freeze({
  detonation: Object.freeze({
    damagePerUnit: 40,
    affectedArea: "range-0-2-from-attacked-target",
    friendlyFire: true,
    confidence: "CONFIG_DERIVED",
    evidence: "Ignition grants SPECIFIC_SPELL_POWER 40 for the after-attack detonation spell; VCMI resolves this as 40 times stack count."
  }),
  heatStroke: Object.freeze({
    usesPerBattle: 99,
    orientationCount: 6,
    relativeCells: Object.freeze(["L", "LL", "FL", "FF", "RF", "RR", "R"]),
    damageModel: "normal-physical-attack",
    friendlyFire: true,
    retaliation: false,
    confidence: "CONFIG_DERIVED",
    evidence: "Heat Stroke is a free self-buff until the next own attack; its attack uses L, LL, FL, FF, RF, RR and R."
  })
});

const FACTORY_REGISTRY = {
  [FACTORY_CREATURE_IDS.HALFLING]: {
    name: "Halfling",
    flags: { ranged: true, meleePenalty: true, positiveLuck: true }
  },
  [FACTORY_CREATURE_IDS.HALFLING_GRENADIER]: {
    name: "Halfling Grenadier",
    flags: { ranged: true, meleePenalty: true, positiveLuck: true, rangedDefenseIgnore: 0.2, spellLikeAttack: "hotaGrenade" }
  },
  [FACTORY_CREATURE_IDS.MECHANIC]: {
    name: "Mechanic",
    flags: { breathAttack: true },
    repair: { hpPerUnit: 10, usesPerBattle: 1, targetCreatureIds: FACTORY_REPAIR_TARGET_IDS }
  },
  [FACTORY_CREATURE_IDS.ENGINEER]: {
    name: "Engineer",
    flags: { breathAttack: true },
    repair: { hpPerUnit: 20, usesPerBattle: 1, targetCreatureIds: FACTORY_REPAIR_TARGET_IDS }
  },
  [FACTORY_CREATURE_IDS.ARMADILLO]: {
    name: "Armadillo",
    flags: { twoHex: true }
  },
  [FACTORY_CREATURE_IDS.BELLWETHER_ARMADILLO]: {
    name: "Bellwether Armadillo",
    flags: { twoHex: true }
  },
  [FACTORY_CREATURE_IDS.AUTOMATON]: {
    name: "Automaton",
    flags: { twoHex: true, mechanical: true, detonation: true },
    detonation: { activationConsumesTurn: false, irreversible: true }
  },
  [FACTORY_CREATURE_IDS.SENTINEL_AUTOMATON]: {
    name: "Sentinel Automaton",
    flags: { twoHex: true, mechanical: true, detonation: true, noRetaliation: true },
    detonation: { activationConsumesTurn: false, irreversible: true }
  },
  [FACTORY_CREATURE_IDS.SANDWORM]: {
    name: "Sandworm",
    flags: { twoHex: true, underground: true },
    immunities: ["blind", "stone", "stone_gaze", "petrify"]
  },
  [FACTORY_CREATURE_IDS.OLGOI_KHORKHOI]: {
    name: "Olgoi-Khorkhoi",
    flags: { twoHex: true, underground: true, corpseDevour: true },
    immunities: ["blind", "stone", "stone_gaze", "petrify"],
    corpseDevour: { summonCreatureId: FACTORY_CREATURE_IDS.SANDWORM_LARVA, usesPerBattle: 50 }
  },
  [FACTORY_CREATURE_IDS.GUNSLINGER]: {
    name: "Gunslinger",
    flags: { ranged: true, meleePenalty: true, rangedRetaliation: true, preemptiveShot: true, retaliationLimit: 1 },
    preemptiveShot: { usesPerRound: 1 }
  },
  [FACTORY_CREATURE_IDS.BOUNTY_HUNTER]: {
    name: "Bounty Hunter",
    flags: { ranged: true, meleePenalty: true, rangedRetaliation: true, preemptiveShot: true, retaliationLimit: Infinity },
    preemptiveShot: { usesPerRound: Infinity }
  },
  [FACTORY_CREATURE_IDS.COUATL]: {
    name: "Couatl",
    flags: { twoHex: true, flying: true, temporaryInvulnerability: true },
    temporaryInvulnerability: { usesPerBattle: 1, activationConsumesTurn: true }
  },
  [FACTORY_CREATURE_IDS.CRIMSON_COUATL]: {
    name: "Crimson Couatl",
    flags: { twoHex: true, flying: true, temporaryInvulnerability: true },
    temporaryInvulnerability: { usesPerBattle: 1, activationConsumesTurn: false }
  },
  [FACTORY_CREATURE_IDS.DREADNOUGHT]: {
    name: "Dreadnought",
    flags: { twoHex: true, mechanical: true, heatStroke: true },
    heatStroke: FACTORY_AUDITED_COMBAT_CONFIG.heatStroke
  },
  [FACTORY_CREATURE_IDS.JUGGERNAUT]: {
    name: "Juggernaut",
    flags: { twoHex: true, mechanical: true, heatStroke: true },
    heatStroke: FACTORY_AUDITED_COMBAT_CONFIG.heatStroke
  },
  [FACTORY_CREATURE_IDS.SANDWORM_LARVA]: {
    name: "Sandworm Larva",
    flags: { noRetaliation: true },
    immunities: ["blind", "stone", "stone_gaze", "petrify"]
  }
};

export const FACTORY_ABILITY_REGISTRY = Object.freeze(
  Object.fromEntries(Object.entries(FACTORY_REGISTRY).map(([id, entry]) => [id, deepFreeze(entry)]))
);

export function creatureIdOf(creatureOrStack) {
  const source = creatureOrStack?.creature || creatureOrStack;
  const value = Number(source?.creatureId);
  return Number.isFinite(value) ? value : null;
}

export function factoryAbilityFor(creatureOrStack) {
  return FACTORY_ABILITY_REGISTRY[creatureIdOf(creatureOrStack)] || null;
}

export function isFactoryMechanical(creatureOrStack) {
  return Boolean(factoryAbilityFor(creatureOrStack)?.flags?.mechanical);
}

export function isFactoryEffectImmune(creatureOrStack, effect) {
  if (creatureOrStack?.invulnerable && effect?.positive !== true) return true;
  const ability = factoryAbilityFor(creatureOrStack);
  if (!ability) return false;
  const type = normalizeEffectType(effect);
  if (ability.immunities?.includes(type)) return true;
  if (!ability.flags?.mechanical) return false;
  if (effect?.mind === true || effect?.livingOnly === true) return true;
  return [
    "berserk", "blind", "forgetfulness", "hypnotize", "mirth", "morale",
    "petrify", "sorrow", "stone", "stone_gaze"
  ].includes(type);
}

export function initializeFactoryStackState(stack, { resetBattle = false } = {}) {
  const ability = factoryAbilityFor(stack);
  if (!ability || !stack) return stack;
  if (resetBattle || stack.preemptiveShotsUsedThisRound === undefined) stack.preemptiveShotsUsedThisRound = 0;
  if (resetBattle || stack.detonationActive === undefined) stack.detonationActive = false;
  if (resetBattle || stack.detonationResolved === undefined) stack.detonationResolved = false;
  if (resetBattle || stack.heatStrokeActive === undefined) stack.heatStrokeActive = false;
  if (resetBattle || stack.heatStrokeExpiresOnTurnStart === undefined) stack.heatStrokeExpiresOnTurnStart = false;
  if (resetBattle || stack.invulnerable === undefined) stack.invulnerable = false;
  if (resetBattle || stack.invulnerableUntilOwnTurn === undefined) stack.invulnerableUntilOwnTurn = false;
  if (resetBattle || stack.corpseConsumed === undefined) stack.corpseConsumed = false;
  if (resetBattle || stack.corpseDevourUsesRemaining === undefined) {
    stack.corpseDevourUsesRemaining = ability.corpseDevour?.usesPerBattle || 0;
  }
  if (resetBattle || stack.heatStrokeUsesRemaining === undefined) {
    stack.heatStrokeUsesRemaining = ability.heatStroke?.usesPerBattle || 0;
  }
  if (resetBattle || stack.repairUsesRemaining === undefined) stack.repairUsesRemaining = ability.repair?.usesPerBattle || 0;
  if (resetBattle || stack.invulnerabilityUsesRemaining === undefined) {
    stack.invulnerabilityUsesRemaining = ability.temporaryInvulnerability?.usesPerBattle || 0;
  }
  return stack;
}

export function resetFactoryRoundState(stack) {
  initializeFactoryStackState(stack);
  if (stack) stack.preemptiveShotsUsedThisRound = 0;
}

export function beginFactoryStackTurn(stack) {
  initializeFactoryStackState(stack);
  if (!stack) return false;
  if (stack.heatStrokeActive && stack.heatStrokeExpiresOnTurnStart) {
    stack.heatStrokeActive = false;
    stack.heatStrokeExpiresOnTurnStart = false;
  }
  if (stack.invulnerableUntilOwnTurn) {
    stack.invulnerable = false;
    stack.invulnerableUntilOwnTurn = false;
    return true;
  }
  return false;
}

export function isStackInvulnerable(stack) {
  return Boolean(stack?.alive !== false && stack?.invulnerable);
}

function normalizeEffectType(effect) {
  return String(typeof effect === "string" ? effect : effect?.type || "")
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, "_");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
