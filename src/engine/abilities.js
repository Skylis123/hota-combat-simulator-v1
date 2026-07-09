const ABILITY_PATTERNS = [
  ["ranged", ["ranged", "shoot", "shooter"]],
  ["flying", ["flying", "fly"]],
  ["noRetaliation", ["no retaliation", "no enemy retaliation"]],
  ["doubleAttack", ["double attack", "attack twice", "two attacks"]],
  ["twoHex", ["two-hex", "2-hex", "wide", "large"]]
];

export function normalizeAbilityText(creature) {
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
  return flags;
}

export function abilityBadges(creature) {
  const flags = inferAbilityFlags(creature);
  const badges = [];
  if (flags.ranged) badges.push("Ranged");
  if (flags.flying) badges.push("Flying");
  if (flags.noRetaliation) badges.push("No retaliation");
  if (flags.doubleAttack) badges.push("Double attack");
  if (flags.twoHex) badges.push("Two-hex TODO");
  return badges;
}
