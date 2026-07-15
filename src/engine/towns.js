export function simulatorTowns(data) {
  const candidates = Array.isArray(data?.towns) && data.towns.length > 0
    ? data.towns
    : data?.town
      ? [data.town]
      : [];
  const seen = new Set();
  return candidates.filter((town) => {
    if (!town) return false;
    const key = townKey(town.townType);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectedTown(data, state) {
  const towns = simulatorTowns(data);
  const selectedKey = townKey(state?.selectedTownType);
  return towns.find((town) => townKey(town.townType) === selectedKey) || towns[0] || null;
}

export function townRosterRows(town) {
  if (!town) return [];
  if (Array.isArray(town.rosterRows) && town.rosterRows.length > 0) {
    return town.rosterRows.map((row, index) => normalizeRosterRow(row, index));
  }

  const tiers = Array.isArray(town.tiers) ? town.tiers : [];
  const rows = tiers.map((tier, index) => normalizeRosterRow(tier, index));
  const specialRecruitment = Array.isArray(town.specialRecruitment) ? town.specialRecruitment : [];
  if (specialRecruitment.length === 0) return rows;

  const fallbackTier = tiers.reduce((highest, tier) => Math.max(highest, Number(tier?.tier) || 0), 0) || 7;
  for (let offset = 0; offset < specialRecruitment.length; offset += 2) {
    const entries = specialRecruitment.slice(offset, offset + 2);
    const tier = Number(entries[0]?.tier) || fallbackTier;
    const variant = Math.floor(offset / 2) + 2;
    rows.push({
      tier,
      label: `T${tier} ${toRoman(variant)}`,
      title: entries.map((entry) => entry.buildingName).filter(Boolean).join(" / ") || "Special recruitment",
      entries
    });
  }
  return rows;
}

function normalizeRosterRow(row, index) {
  const tier = Number(row?.tier) || index + 1;
  const entries = Array.isArray(row?.entries)
    ? row.entries
    : Array.isArray(row?.creatures)
      ? row.creatures
      : [row?.base, row?.upgrade];
  return {
    tier,
    label: row?.label || `T${tier}`,
    title: row?.title || row?.buildingName || "",
    entries: entries.filter(Boolean).map((entry) => Number.isInteger(entry) ? { creatureId: entry } : entry)
  };
}

function townKey(townType) {
  return String(townType ?? "");
}

function toRoman(value) {
  return ["", "I", "II", "III", "IV", "V"][value] || String(value);
}
