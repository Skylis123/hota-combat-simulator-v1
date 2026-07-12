import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { createCanvas, Image: CanvasImage, loadImage } = require("@napi-rs/canvas");
const root = path.resolve(import.meta.dirname, "..");

class LocalImage extends CanvasImage {
  set src(value) {
    const resolved = typeof value === "string" && value.startsWith("./public/")
      ? path.join(root, value.slice(2))
      : value;
    super.src = typeof resolved === "string" ? fs.readFileSync(resolved) : resolved;
    this.decode().then(() => this.onload?.(), (error) => this.onerror?.(error));
  }
}

globalThis.document = {
  createElement(tagName) {
    if (tagName !== "canvas") throw new Error(`Unsupported test element: ${tagName}`);
    return createCanvas(1, 1);
  }
};
globalThis.window = {};
globalThis.Image = LocalImage;
globalThis.createImageBitmap = async (file) => loadImage(Buffer.from(await file.arrayBuffer()));

const [{ analyzeBattlefieldScreenshot }] = await Promise.all([
  import(pathToFileURL(path.join(root, "src/engine/screenshotAnalyzer.js")))
]);
const simulator = JSON.parse(fs.readFileSync(path.join(root, "public/data/simulator-v1-data.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "public/data/battlefield-catalog.json"), "utf8"));
const detection = JSON.parse(fs.readFileSync(path.join(root, "public/assets/creatures/detection/manifest.json"), "utf8"));
const data = { ...simulator, obstacles: catalog.obstacles, backgrounds: catalog.backgrounds, creatureDetection: detection };
const screenshotPath = path.resolve(process.argv[2]);
const bytes = fs.readFileSync(screenshotPath);
const file = new Blob([bytes], { type: "image/png" });
const result = await analyzeBattlefieldScreenshot(file, data);
const summary = {
  backgroundId: result.backgroundId,
  obstacles: result.obstacles.map(({ id, name, anchorHexId }) => ({ id, name, anchorHexId })),
  stacks: result.stacks.map((stack) => ({ creature: stack.creature.name, owner: stack.owner, count: stack.count, hexId: stack.hexId, armySlot: stack.armySlot }))
};
if (process.argv.includes("--assert-reference")) {
  const signature = summary.stacks.map(({ creature, owner, count, hexId }) => `${owner}:${creature}:${count}@${hexId}`).sort();
  const expected = [
    "ai:Cavalier:6@67",
    "player:Griffin:6@121",
    "player:Marksman:22@0",
    "player:Pikeman:1@60",
    "player:Pikeman:1@75",
    "player:Pikeman:1@90",
    "player:Pikeman:1@150",
    "player:Pikeman:20@30"
  ].sort();
  if (JSON.stringify(signature) !== JSON.stringify(expected)) throw new Error(`Unexpected stack signature: ${signature.join(", ")}`);
  if (summary.backgroundId !== "cmbkgrtr") throw new Error(`Unexpected background: ${summary.backgroundId}`);
  const obstacleSignature = summary.obstacles.map(({ id, anchorHexId }) => `${id}@${anchorHexId}`).sort();
  if (JSON.stringify(obstacleSignature) !== JSON.stringify(["106@null", "22@141"].sort())) {
    throw new Error(`Unexpected obstacles: ${obstacleSignature.join(", ")}`);
  }
}
console.log(JSON.stringify(summary, null, 2));
