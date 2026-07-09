import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Simulator V1 data check passed.");
