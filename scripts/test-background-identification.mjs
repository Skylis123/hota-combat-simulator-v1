import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { identifyBackground } from "../src/engine/screenshotAnalyzer.js";

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const root = path.resolve(import.meta.dirname, "..");

globalThis.document = {
  createElement(tagName) {
    if (tagName !== "canvas") throw new Error(`Unsupported test element: ${tagName}`);
    return createCanvas(1, 1);
  }
};

const catalog = JSON.parse(fs.readFileSync(path.join(root, "public/data/battlefield-catalog.json"), "utf8"));
const failures = [];
for (const background of catalog.backgrounds) {
  const image = await loadImage(path.join(root, "public", background.image));
  const canvas = createCanvas(800, 556);
  canvas.getContext("2d").drawImage(image, 0, 0, 800, 556);
  const detected = identifyBackground(canvas, catalog.backgrounds);
  if (detected !== background.id) failures.push(`${background.id} -> ${detected}`);
}

if (failures.length) {
  throw new Error(`Background identification regressions: ${failures.join(", ")}`);
}
console.log(`Battlefield background identification passed: ${catalog.backgrounds.length}/${catalog.backgrounds.length}.`);
