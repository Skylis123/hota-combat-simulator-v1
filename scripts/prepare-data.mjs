import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "..");
const sourceData = path.join(workspaceRoot, "exports", "data", "simulator_db");
const sourceAssets = path.join(workspaceRoot, "exports", "assets");
const publicRoot = path.join(appRoot, "public");

const outData = path.join(publicRoot, "data");
const outAssets = path.join(publicRoot, "assets");

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceData, fileName), "utf8"));
}

function ensureDir(dir) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  ensureDir(dir);
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function copyFileIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) return null;
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return path.relative(publicRoot, destination).replaceAll("\\", "/");
}

function copyExportAsset(exportPath) {
  if (!exportPath) return null;
  const normalized = exportPath.replaceAll("\\", "/");
  const marker = "exports/assets/";
  const index = normalized.indexOf(marker);
  if (index < 0) return null;
  const relativeAsset = normalized.slice(index + marker.length);
  const source = path.join(sourceAssets, ...relativeAsset.split("/"));
  const destination = path.join(outAssets, ...relativeAsset.split("/"));
  return copyFileIfExists(source, destination);
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))];
}

function normalizeCreature(creature, asset) {
  const preview = copyExportAsset(asset?.previewPng || asset?.previewImage);
  const idle = copyExportAsset(asset?.idleGif || asset?.idleAnimation);
  const spritesheet = copyExportAsset(asset?.spritesheetPng || asset?.spritesheet);
  const stats = creature.stats || creature;
  const abilities = creature.decodedAbilities || creature.abilities || [];

  return {
    creatureId: creature.creatureId,
    name: creature.displayName || creature.name || creature.internalName,
    tier: creature.tier ?? null,
    upgrade: creature.upgrade ?? null,
    status: creature.status || "CONFIRMED",
    stats: {
      attack: stats.attack ?? null,
      defense: stats.defense ?? null,
      minDamage: stats.minDamage ?? stats.damageMin ?? null,
      maxDamage: stats.maxDamage ?? stats.damageMax ?? null,
      hp: stats.hp ?? stats.health ?? null,
      speed: stats.speed ?? null,
      shots: stats.shots ?? stats.ammo ?? 0,
      growth: stats.growth ?? null,
      costGold: stats.costGold ?? stats.cost?.gold ?? null,
      aiValue: stats.aiValue ?? null,
      fightValue: stats.fightValue ?? null
    },
    abilities,
    asset: {
      displayImage: idle || preview || "assets/placeholders/creature-placeholder.svg",
      idleAnimation: idle,
      previewImage: preview,
      spritesheet,
      assetStatus: asset?.assetStatus || asset?.status || (preview || idle ? "EXTRACTED" : "NOT_FOUND"),
      sourceArchive: asset?.sourceArchive || asset?.source || null,
      fallbackReason: idle ? null : preview ? "idleAnimation missing; using preview PNG" : "asset missing; using placeholder"
    }
  };
}

function normalizeGrid(visibleGrid) {
  const rawHexes = visibleGrid.hexes || visibleGrid.mapping || [];
  const engineToVisible = new Map(rawHexes.map((hex) => [hex.engineId ?? hex.id, hex.id ?? hex.visibleId]));
  return {
    id: visibleGrid.gridId || "visible_15x11_165",
    status: visibleGrid.status || "CONFIRMED",
    source: visibleGrid.source || [],
    width: visibleGrid.width || 800,
    height: visibleGrid.height || 556,
    rows: visibleGrid.rows || 11,
    columns: visibleGrid.columns || visibleGrid.visibleCols || 15,
    hexCount: rawHexes.length,
    hexes: rawHexes.map((hex) => {
      const engineNeighbors = hex.neighborEngineIds || hex.neighborsEngineIds || hex.neighbors || [];
      const visibleNeighbors = uniqueNumbers(engineNeighbors.map((engineId) => engineToVisible.get(engineId)));
      return {
        id: hex.id ?? hex.visibleId,
        engineId: hex.engineId ?? hex.id,
        row: hex.row,
        col: hex.col ?? hex.visibleCol,
        centerX: Math.round(hex.centerX),
        centerY: Math.round(hex.centerY),
        polygonPoints: hex.polygonPoints || hex.polygon || [],
        neighbors: visibleNeighbors
      };
    })
  };
}

function main() {
  cleanDir(outData);
  ensureDir(path.join(outAssets, "creatures"));
  ensureDir(path.join(outAssets, "battlefields"));
  ensureDir(path.join(outAssets, "placeholders"));

  const towns = readJson("towns.json");
  const creatures = readJson("creatures.json");
  const creatureAssets = readJson("creature_assets.json");
  const battlefields = readJson("battlefields.json");
  const visibleGrid = readJson("battlefield_visible_hex_grid.json");

  const castle = towns.towns.find((town) => town.townType === 0);
  if (!castle) throw new Error("Castle townType 0 was not found in towns.json");

  const castleCreatureIds = castle.tiers.flatMap((tier) => [tier.base?.creatureId, tier.upgrade?.creatureId]).filter(Number.isInteger);
  const creatureById = new Map((creatures.creatures || []).map((creature) => [creature.creatureId, creature]));
  const assetById = new Map((creatureAssets.creatures || creatureAssets.assets || []).map((asset) => [asset.creatureId, asset]));
  const castleCreatures = castleCreatureIds.map((id) => normalizeCreature(creatureById.get(id), assetById.get(id)));

  const backgroundName = "cmbkgrtr.png";
  const backgroundSource = path.join(sourceAssets, "battlefields", "backgrounds", backgroundName);
  const backgroundTarget = path.join(outAssets, "battlefields", "backgrounds", backgroundName);
  const backgroundPath = copyFileIfExists(backgroundSource, backgroundTarget);
  const backgroundRecord = (battlefields.backgrounds || []).find((entry) => entry.fileName === backgroundName || entry.name?.toLowerCase?.() === "cmbkgrtr");

  fs.writeFileSync(
    path.join(outAssets, "placeholders", "creature-placeholder.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="8" fill="#23272f"/><path d="M24 67c5-17 13-31 24-42 11 11 19 25 24 42H24Z" fill="#6f7d52"/><circle cx="48" cy="42" r="8" fill="#d7d9b1"/></svg>\n`,
    "utf8"
  );

  const output = {
    schemaVersion: 1,
    generatedUtc: new Date().toISOString(),
    verificationTier: "engine_verified_hd_variant maximum; exact-build verification forbidden",
    scope: {
      town: "Castle",
      townType: 0,
      phase: "Simulator V1",
      limits: [
        "Castle-only setup",
        "15x11 visible grid / 165 visual hexes",
        "single grass battlefield",
        "two-hex occupancy is displayed as TODO"
      ]
    },
    town: castle,
    creatures: castleCreatures,
    battlefield: {
      id: "grass_castle_v1",
      name: "Grass / Castle-like battlefield",
      background: {
        image: backgroundPath,
        sourceName: backgroundName,
        status: backgroundPath ? "EXTRACTED" : "NOT_FOUND",
        source: backgroundRecord || null,
        width: 800,
        height: 556
      },
      grid: normalizeGrid(visibleGrid)
    }
  };

  fs.writeFileSync(path.join(outData, "simulator-v1-data.json"), JSON.stringify(output, null, 2), "utf8");
  fs.writeFileSync(path.join(outData, "battlefield_visible_hex_grid.json"), JSON.stringify(output.battlefield.grid, null, 2), "utf8");
  console.log(`Prepared ${castleCreatures.length} Castle creatures and ${output.battlefield.grid.hexCount} visible hexes.`);
}

main();
