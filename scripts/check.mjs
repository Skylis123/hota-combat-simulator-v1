import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBattleStack, createInitialState, resetBattle, startBattle } from "../src/engine/battleState.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "public", "data", "simulator-v1-data.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8").replace(/^\uFEFF/, ""));

const failures = [];
if (data.scope?.town !== "Castle") failures.push("V1 data is not Castle-scoped.");
if ((data.creatures || []).length !== 14) failures.push("Castle creature subset must contain 14 base/upgraded units.");
if (data.battlefield?.grid?.hexCount !== 165) failures.push("Visible grid must contain 165 hexes.");
if (!fs.existsSync(path.join(root, "public", data.battlefield.background.image))) failures.push("Battlefield background is missing.");

for (const creature of data.creatures || []) {
  const image = creature.asset?.displayImage;
  if (!image || !fs.existsSync(path.join(root, "public", image))) {
    failures.push(`Missing display image for creature ${creature.creatureId} ${creature.name}`);
  }
}

for (const animation of ["move.gif", "attack-up.gif", "attack-front.gif", "attack-down.gif"]) {
  if (!fs.existsSync(path.join(root, "public", "assets", "creatures", "animations", "0", animation))) {
    failures.push(`Missing Pikeman battle animation: ${animation}`);
  }
}

const resetCreature = { name: "Reset test", stats: { hp: 30, shots: 12, speed: 5 } };
const resetState = createInitialState();
resetState.stacks = [
  createBattleStack({ creature: resetCreature, owner: "player", hexId: 12, count: 20, createdAt: 0 }),
  createBattleStack({ creature: resetCreature, owner: "ai", hexId: 99, count: 15, createdAt: 1 })
];
startBattle(resetState);
Object.assign(resetState.stacks[0], { hexId: 55, count: 3, hpTotal: 61, shotsRemaining: 2 });
Object.assign(resetState.stacks[1], { count: 0, hpTotal: 0, alive: false });
resetBattle(resetState);
if (
  resetState.stacks[0].hexId !== 12 ||
  resetState.stacks[0].count !== 20 ||
  resetState.stacks[0].hpTotal !== 600 ||
  resetState.stacks[0].shotsRemaining !== 12 ||
  resetState.stacks[1].count !== 15 ||
  resetState.stacks[1].alive !== true
) {
  failures.push("Reset Battle must restore starting positions and complete stack state.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Simulator V1 data check passed.");
