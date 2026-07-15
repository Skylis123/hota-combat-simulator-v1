export async function loadSimulatorData() {
  const [response, factoryResponse, catalogResponse, detectionResponse] = await Promise.all([
    fetch("./public/data/simulator-v1-data.json", { cache: "no-store" }),
    fetch("./public/data/factory-creatures.json", { cache: "no-store" }),
    fetch("./public/data/battlefield-catalog.json", { cache: "no-store" }),
    fetch("./public/assets/creatures/detection/manifest.json", { cache: "no-store" })
  ]);
  if (!response.ok || !factoryResponse.ok || !catalogResponse.ok || !detectionResponse.ok) {
    throw new Error(
      `Could not load simulator data (${response.status}/${factoryResponse.status}/${catalogResponse.status}/${detectionResponse.status})`
    );
  }
  const [data, factoryData, catalog, detection] = await Promise.all([
    response.json(),
    factoryResponse.json(),
    catalogResponse.json(),
    detectionResponse.json()
  ]);
  const baseTowns = Array.isArray(data.towns) && data.towns.length > 0
    ? data.towns
    : data.town
      ? [data.town]
      : [];
  const factoryTown = normalizeFactoryTown(factoryData.town);
  const townsByType = new Map(baseTowns.map((town) => [String(town.townType), town]));
  if (factoryTown) townsByType.set(String(factoryTown.townType), factoryTown);

  const creaturesById = new Map();
  for (const creature of [...(data.creatures || []), ...(factoryData.creatures || [])]) {
    if (Number.isInteger(Number(creature?.creatureId))) {
      creaturesById.set(Number(creature.creatureId), creature);
    }
  }
  const towns = [...townsByType.values()];
  return {
    ...data,
    // Keep the original Castle contract for older consumers while the new UI
    // reads all available factions from `towns`.
    town: data.town || towns.find((town) => Number(town.townType) === 0) || towns[0] || null,
    towns,
    creatures: [...creaturesById.values()],
    obstacles: catalog.obstacles,
    backgrounds: catalog.backgrounds,
    creatureDetection: detection
  };
}

function normalizeFactoryTown(town) {
  if (!town) return null;
  const lines = Array.isArray(town.creatureLines) ? town.creatureLines : [];
  let tierSevenRows = 0;
  const rosterRows = lines.map((line) => {
    const tier = Number(line.tier);
    const isAlternateTierSeven = tier === 7 && tierSevenRows++ > 0;
    return {
      tier,
      label: isAlternateTierSeven ? "T7 II" : `T${tier}`,
      title: line.branch && line.branch !== "main" ? line.branch : "",
      entries: [line.base, line.upgrade]
        .filter((creatureId) => Number.isInteger(Number(creatureId)))
        .map((creatureId) => ({ creatureId: Number(creatureId) }))
    };
  });
  return {
    ...town,
    origin: town.origin || "Horn of the Abyss",
    rosterRows
  };
}
