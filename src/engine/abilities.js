const ABILITY_PATTERNS = [
  ["ranged", ["ranged", "shoot", "shooter"]],
  ["flying", ["flying", "fly"]],
  ["noRetaliation", ["no retaliation", "no enemy retaliation"]],
  ["doubleAttack", ["double attack", "attack twice", "two attacks"]],
  ["twoHex", ["two-hex", "2-hex", "wide", "large"]]
];

const CASTLE_ABILITIES = {
  0: { joustingImmune: true },
  1: { joustingImmune: true },
  2: { ranged: true, meleePenalty: true },
  3: { ranged: true, meleePenalty: true, doubleAttack: true },
  4: { flying: true, twoHex: true, retaliationLimit: 2, doubleAttack: false },
  5: { flying: true, twoHex: true, retaliationLimit: Infinity, doubleAttack: false },
  6: {},
  7: { doubleAttack: true },
  8: { ranged: true, meleePenalty: true },
  9: { ranged: true, noMeleePenalty: true },
  10: { twoHex: true, jousting: true },
  11: { twoHex: true, jousting: true },
  12: { flying: true, moraleBonus: 1, hatesDevils: true },
  13: { flying: true, twoHex: true, moraleBonus: 1, hatesDevils: true, resurrection: true }
};

const CASTLE_ABILITY_NOTES = {
  0: ["Immune to jousting bonus"],
  1: ["Immune to jousting bonus"],
  2: ["Shoots; 50% melee penalty"],
  3: ["Shoots twice; 50% melee penalty"],
  4: ["Two-hex flyer; retaliates twice per round"],
  5: ["Two-hex flyer; unlimited retaliations"],
  6: [],
  7: ["Strikes twice"],
  8: ["Shoots; 50% melee penalty"],
  9: ["Shoots; no melee penalty"],
  10: ["Two-hex; jousting gives +5% damage per hex travelled"],
  11: ["Two-hex; jousting gives +5% damage per hex travelled"],
  12: ["Flies; +1 morale; hates Devils"],
  13: ["Two-hex flyer; +1 morale; hates Devils; resurrects allies once per battle (100 HP per Archangel)"]
};

export function normalizeAbilityText(creature) {
  if (Object.hasOwn(CASTLE_ABILITY_NOTES, creature?.creatureId)) return [...CASTLE_ABILITY_NOTES[creature.creatureId]];
  const values = creature?.abilities || [];
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      if (value && typeof value === "object") return [value.name, value.details].filter(Boolean).join(": ");
      return "";
    })
    .map((value) => String(value).trim())
    .filter(Boolean);
}

export function inferAbilityFlags(creature) {
  const text = normalizeAbilityText(creature).join(" ").toLowerCase();
  const flags = {};
  for (const [key, patterns] of ABILITY_PATTERNS) {
    flags[key] = patterns.some((pattern) => text.includes(pattern));
  }
  if ((creature?.stats?.shots || 0) > 0) flags.ranged = true;
  const exactCastle = CASTLE_ABILITIES[creature?.creatureId];
  if (exactCastle) Object.assign(flags, exactCastle);
  return flags;
}

export function abilityBadges(creature) {
  const flags = inferAbilityFlags(creature);
  const badges = [];
  if (flags.ranged) badges.push("Ranged");
  if (flags.flying) badges.push("Flying");
  if (flags.noRetaliation) badges.push("No retaliation");
  if (flags.doubleAttack) badges.push("Double attack");
  if (flags.meleePenalty) badges.push("50% melee penalty");
  if (flags.noMeleePenalty) badges.push("No melee penalty");
  if (flags.retaliationLimit === 2) badges.push("2 retaliations / round");
  if (flags.retaliationLimit === Infinity) badges.push("Unlimited retaliations");
  if (flags.jousting) badges.push("Jousting +5% / hex");
  if (flags.joustingImmune) badges.push("Immune to jousting");
  if (flags.moraleBonus) badges.push(`+${flags.moraleBonus} morale (turn proc pending)`);
  if (flags.hatesDevils) badges.push("Hates Devils (+50% damage)");
  if (flags.resurrection) badges.push("Resurrection 1 / battle");
  if (flags.twoHex) badges.push("Two-hex creature");
  return badges;
}
