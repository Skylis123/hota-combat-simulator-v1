import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nativeBattleHexGeometry } from "../src/engine/battleGeometry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const simulatorPath = path.join(root, "public", "data", "simulator-v1-data.json");
const gridPath = path.join(root, "public", "data", "battlefield_visible_hex_grid.json");

const simulator = readJson(simulatorPath);
const standaloneGrid = readJson(gridPath);
refreshGrid(simulator.battlefield.grid);
refreshGrid(standaloneGrid);
writeJson(simulatorPath, simulator);
writeJson(gridPath, standaloneGrid);

console.log(`Refreshed ${standaloneGrid.hexes.length} battlefield cells from native Heroes III geometry.`);

function refreshGrid(grid) {
  if (!grid || !Array.isArray(grid.hexes) || grid.hexes.length !== 165) {
    throw new Error("Expected the canonical 15x11 visible battlefield grid.");
  }
  for (const hex of grid.hexes) {
    const geometry = nativeBattleHexGeometry(hex);
    if (!geometry) throw new Error(`Invalid battlefield cell ${hex.id}.`);
    hex.centerX = geometry.centerX;
    hex.centerY = geometry.centerY;
    hex.polygonPoints = geometry.polygonPoints;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
