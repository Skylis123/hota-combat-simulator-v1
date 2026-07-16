const NEUTRAL_FLAGS = {
  116: { nonLiving: true },
  117: { nonLiving: true },
  132: { flying: true, twoHex: true, breathAttack: true, fearAura: 0.1, fearImmune: true },
  133: { twoHex: true },
  134: { flying: true, twoHex: true },
  135: { flying: true, twoHex: true, breathAttack: true, acidBreath: true },
  136: { ranged: true, noMeleePenalty: true, noWallPenalty: true },
  137: { ranged: true, meleePenalty: true, noRangePenalty: true, noWallPenalty: true },
  139: {},
  140: { twoHex: true },
  141: { undead: true, nonLiving: true, mindImmune: true },
  142: { twoHex: true },
  143: {},
  144: { regeneration: 50 },
  167: {},
  168: { flying: true, retaliationLimit: Infinity, mindImmune: true },
  169: { luckAura: 2 },
  170: { nonLiving: true }
};

export function neutralAbilityFor(creatureOrStack) {
  const creatureId = Number(creatureOrStack?.creature?.creatureId ?? creatureOrStack?.creatureId);
  return NEUTRAL_FLAGS[creatureId] || null;
}

export function beginNeutralStackTurn(state, stack) {
  if (!stack) return { skipped: false, regeneratedHp: 0 };
  const flags = neutralAbilityFor(stack) || {};
  let regeneratedHp = 0;
  if (flags.regeneration && Number(stack.wound || 0) > 0) {
    regeneratedHp = Math.min(Number(flags.regeneration), Number(stack.wound || 0));
    stack.hpTotal = Number(stack.hpTotal || 0) + regeneratedHp;
    stack.wound = Math.max(0, Number(stack.wound || 0) - regeneratedHp);
    state?.actionLog?.unshift(`${stack.label} regenerates ${regeneratedHp} HP.`);
  }

  if (isFearImmune(stack) || !hasEnemyFearAura(state, stack.owner)) return { skipped: false, regeneratedHp };
  const rng = typeof state?.rng === "function" ? state.rng : Math.random;
  if (rng() >= 0.1) return { skipped: false, regeneratedHp };
  stack.statuses ||= {};
  stack.statuses.acted = true;
  state.lastMovedOwner = stack.owner;
  state?.actionLog?.unshift(`${stack.label} freezes in fear and loses its turn.`);
  return { skipped: true, regeneratedHp };
}

export function friendlyLuckChanceMultiplier(state, owner) {
  return (state?.stacks || []).some((stack) => (
    stack.owner === owner
    && stack.alive !== false
    && Number(stack.count || 0) > 0
    && Number(neutralAbilityFor(stack)?.luckAura || 0) > 1
  )) ? 2 : 1;
}

function hasEnemyFearAura(state, owner) {
  return (state?.stacks || []).some((stack) => (
    stack.owner !== owner
    && stack.alive !== false
    && Number(stack.count || 0) > 0
    && Number(neutralAbilityFor(stack)?.fearAura || 0) > 0
  ));
}

function isFearImmune(stack) {
  const flags = neutralAbilityFor(stack) || {};
  return Boolean(flags.fearImmune || flags.mindImmune || flags.nonLiving || flags.undead);
}
