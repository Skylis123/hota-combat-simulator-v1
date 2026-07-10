import { inferAbilityFlags } from "./abilities.js";

const CONFIDENCE = {
  CONFIRMED: "CONFIRMED",
  LIKELY: "LIKELY",
  APPROXIMATION: "APPROXIMATION",
  UNKNOWN: "UNKNOWN"
};

export function calculateBaseUnitValue(creature) {
  const stats = creature?.stats || {};
  const tableValue = stats.aiValue ?? stats.fightValue;
  if (Number.isFinite(tableValue)) {
    return {
      value: Number(tableValue),
      source: stats.aiValue != null ? "creature.stats.aiValue" : "creature.stats.fightValue",
      confidence: stats.aiValue != null ? CONFIDENCE.LIKELY : CONFIDENCE.APPROXIMATION,
      note: "FUN_00442770 uses a creature-table base value; aiValue is the closest exported simulator field."
    };
  }

  const averageDamage = ((stats.minDamage || 0) + (stats.maxDamage || 0)) / 2;
  const fallback = Math.max(1, Math.round((stats.hp || 1) * Math.max(1, averageDamage) * Math.max(1, stats.speed || 1) / 4));
  return {
    value: fallback,
    source: "derived fallback",
    confidence: CONFIDENCE.APPROXIMATION,
    note: "Used only when extracted creature value fields are missing."
  };
}

export function applyStatusModifiersToEvaluation(stack) {
  const creature = stack.creature || stack;
  const stats = creature.stats || {};
  const effects = stack.effects || [];
  let attack = Number(stats.attack || 0);
  let defense = Number(stats.defense || 0) + Number(stack.defenseBonus || 0);
  let hpPerUnit = Number(stats.hp || 1);
  let speed = Number(stats.speed || 0);
  let damageMin = Number(stats.minDamage || 0);
  let damageMax = Number(stats.maxDamage || 0);
  let actionDenied = false;
  const notes = [];

  for (const effect of effects) {
    const type = String(effect.type || "").toLowerCase();
    if (type === "age") {
      hpPerUnit *= 0.5;
      notes.push("Age-like effect halves hpPerUnit in confirmed HotA runtime fixtures.");
    } else if (type === "poison") {
      hpPerUnit *= 0.9;
      notes.push("Poison fixture showed hpPerUnit 250 -> 225.");
    } else if (type === "disease") {
      if (Number.isFinite(effect.attackDelta)) attack += effect.attackDelta;
      if (Number.isFinite(effect.defenseDelta)) defense += effect.defenseDelta;
      notes.push("Disease runtime changes attack/defense, but generic formula is not fully named.");
    } else if (["blind", "paralyze", "stone", "petrify"].includes(type)) {
      actionDenied = true;
      notes.push(`${effect.type} disables or blocks action in runtime/status scoring contexts.`);
    } else if (type === "haste" || type === "slow") {
      speed += Number(effect.speedDelta || 0);
      notes.push(`${effect.type} speed delta supplied by caller; spell scoring is out of this unit-only phase.`);
    } else if (type === "custom") {
      attack += Number(effect.attackDelta || 0);
      defense += Number(effect.defenseDelta || 0);
      speed += Number(effect.speedDelta || 0);
      damageMin += Number(effect.damageMinDelta || 0);
      damageMax += Number(effect.damageMaxDelta || 0);
      hpPerUnit *= Number(effect.hpMultiplier || 1);
      notes.push("Custom status modifier supplied by simulator/test data.");
    }
  }

  return {
    attack,
    defense,
    hpPerUnit: Math.max(1, hpPerUnit),
    speed: Math.max(0, speed),
    damageMin: Math.max(0, damageMin),
    damageMax: Math.max(0, damageMax),
    actionDenied,
    notes
  };
}

export function calculateUnitValue(stack, battleState = null) {
  const creature = stack.creature || stack;
  const base = calculateBaseUnitValue(creature);
  const effective = applyStatusModifiersToEvaluation(stack);
  const stats = creature.stats || {};
  const baseAttack = Number(stats.attack || 0);
  const baseDefense = Number(stats.defense || 0);
  const attackDelta = effective.attack - baseAttack;
  const defenseDelta = effective.defense - baseDefense;
  const attackFactor = 1 + 0.05 * attackDelta;
  const defenseFactor = 1 + 0.05 * defenseDelta;
  const product = Math.max(0, attackFactor * defenseFactor);
  const unitValue = base.value * Math.sqrt(product);

  return {
    value: unitValue,
    rounded: Math.trunc(unitValue),
    baseValue: base.value,
    baseSource: base.source,
    attackFactor,
    defenseFactor,
    attackDelta,
    defenseDelta,
    effective,
    confidence: base.confidence,
    evidence: "Matches confirmed FUN_00442770 shape: creatureBaseValue * sqrt(attackFactor * defenseFactor). Runtime side/hero/context fields are not fully present in Simulator V1."
  };
}

export function calculateBaseStackPower(stack) {
  const unit = calculateUnitValue(stack);
  const count = Number(stack.count || 0);
  const hpPerUnit = Number(unit.effective?.hpPerUnit || (stack.creature || stack).stats?.hp || 1);
  const wound = Number(stack.wound || 0);
  const livingUnitsEquivalent = Math.max(0, count - wound / hpPerUnit);
  const value = unit.value * livingUnitsEquivalent;

  return {
    value,
    rounded: Math.trunc(value),
    unitValue: unit.value,
    count,
    wound,
    livingUnitsEquivalent,
    confidence: unit.confidence,
    evidence: "Stack value is unitValue prorated by living unit-equivalent HP. This follows FUN_00442cf0 HP-loss/value behavior, but full battle context is approximated."
  };
}

export function calculateEffectiveStackPower(stack, battleState = null) {
  const base = calculateBaseStackPower(stack);
  const effective = applyStatusModifiersToEvaluation(stack);
  const actionFactor = effective.actionDenied ? 0.05 : 1;
  const value = base.value * actionFactor;
  return {
    ...base,
    value,
    rounded: Math.trunc(value),
    actionFactor,
    effective,
    confidence: effective.actionDenied ? CONFIDENCE.APPROXIMATION : base.confidence
  };
}

export function calculateExpectedDamage(attacker, defender, battleState = null, options = {}) {
  const attackerEval = applyStatusModifiersToEvaluation(attacker);
  const defenderEval = applyStatusModifiersToEvaluation(defender);
  if (attackerEval.actionDenied) {
    return { damage: 0, confidence: CONFIDENCE.APPROXIMATION, evidence: "Attacker action denied by status." };
  }

  const count = Number(attacker.count || 0);
  const averagePerUnit = (attackerEval.damageMin + attackerEval.damageMax) / 2;
  const base = averagePerUnit * count;
  const statDelta = attackerEval.attack - defenderEval.defense;
  const factor = statDelta >= 0
    ? 1 + Math.min(3, 0.05 * statDelta)
    : Math.max(0.3, 1 - 0.025 * Math.abs(statDelta));
  const abilities = inferAbilityFlags(attacker.creature || attacker);
  const includeMultiHit = options.includeMultiHit !== false;
  const hitMultiplier = includeMultiHit && abilities.doubleAttack ? 2 : 1;
  const meleePenalty = options.mode === "melee" && abilities.ranged && !abilities.noMeleePenalty ? 0.5 : 1;
  const joustingPercent = options.mode === "melee" && abilities.jousting && !inferAbilityFlags(defender.creature || defender).joustingImmune
    ? 100 + Math.max(0, Number(options.movementSteps || 0)) * 5
    : 100;
  const joustingMultiplier = joustingPercent / 100;
  const defenderId = Number((defender.creature || defender).creatureId);
  const hateMultiplier = abilities.hatesDevils && (defenderId === 54 || defenderId === 55) ? 1.5 : 1;
  const damage = Math.max(1, Math.trunc((base * factor * hitMultiplier * meleePenalty * joustingPercent * hateMultiplier) / 100));

  return {
    damage,
    base,
    factor,
    hitMultiplier,
    meleePenalty,
    joustingMultiplier,
    hateMultiplier,
    confidence: CONFIDENCE.CONFIRMED,
    evidence: "Uses confirmed deterministic AI damage shape: mean min/max * count, attack/defense factor, double attack where flagged."
  };
}

export function calculateHpLossValue(stack, hpAmount) {
  const unit = calculateUnitValue(stack);
  const hpPerUnit = Number(unit.effective?.hpPerUnit || (stack.creature || stack).stats?.hp || 1);
  const wound = Number(stack.wound || 0);
  const amount = Math.max(0, Number(hpAmount || 0));
  const remainder = amount % hpPerUnit;
  const creditedPriorDamage = remainder + wound >= hpPerUnit ? wound : 0;
  const value = ((amount + creditedPriorDamage) * unit.value) / hpPerUnit;
  return {
    value,
    rounded: Math.trunc(value),
    unitValue: unit.value,
    creditedPriorDamage,
    confidence: unit.confidence,
    evidence: "Implements normal FUN_00442cf0 HP-loss/value conversion without unknown bit-23 or fixed-1000 branches."
  };
}

export function calculateTargetPriority(attacker, defender, battleState = null, options = {}) {
  const outgoing = calculateExpectedDamage(attacker, defender, battleState, options);
  const targetLoss = calculateHpLossValue(defender, outgoing.damage);
  const abilities = inferAbilityFlags(attacker.creature || attacker);
  let retaliationDamage = 0;
  let retaliationLoss = { value: 0, rounded: 0 };

  if (!abilities.noRetaliation) {
    const incoming = calculateExpectedDamage(defender, attacker, battleState, { mode: "melee" });
    retaliationDamage = incoming.damage;
    retaliationLoss = calculateHpLossValue(attacker, retaliationDamage);
  }

  const score = targetLoss.value - retaliationLoss.value;
  return {
    score,
    rounded: Math.trunc(score),
    outgoingDamage: outgoing.damage,
    targetLossValue: targetLoss.value,
    retaliationDamage,
    retaliationLossValue: retaliationLoss.value,
    confidence: CONFIDENCE.APPROXIMATION,
    evidence: "Approximates confirmed physical exchange utility: target value lost minus attacker value lost. Full FUN_00435600 exchange context is not yet wired into UI."
  };
}

export function calculateThreatScore(stack, battleState = null) {
  const power = calculateEffectiveStackPower(stack, battleState);
  const effective = applyStatusModifiersToEvaluation(stack);
  const abilities = inferAbilityFlags(stack.creature || stack);
  const mobilityFactor = 1 + Math.min(0.5, effective.speed / 40);
  const rangedFactor = abilities.ranged ? 1.15 : 1;
  const value = power.value * mobilityFactor * rangedFactor;
  return {
    value,
    rounded: Math.trunc(value),
    power: power.value,
    mobilityFactor,
    rangedFactor,
    confidence: CONFIDENCE.APPROXIMATION,
    evidence: "Threat score is a Simulator V1 helper, not a single confirmed engine global combat-power formula."
  };
}

export { CONFIDENCE };
