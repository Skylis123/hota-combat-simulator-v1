import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { templateEmbeddingRatio } from "../src/engine/templateOverlap.js";

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "public/data/battlefield-catalog.json"), "utf8"));
const definitions = new Map(catalog.obstacles.map((definition) => [definition.id, definition]));
const records = new Map();
const EMBEDDED_COMPONENT_THRESHOLD = 0.25;

async function record({ id, left, top }) {
  const key = `${id}@${left},${top}`;
  if (records.has(key)) return records.get(key);
  const definition = definitions.get(id);
  const image = await loadImage(path.join(root, "public", definition.image));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const value = {
    id,
    left,
    top,
    width: image.width,
    height: image.height,
    pixels: context.getImageData(0, 0, image.width, image.height).data
  };
  records.set(key, value);
  return value;
}

const realScenes = {
  "74fe": [
    { id: 204, left: 564, top: 170 }, { id: 209, left: 234, top: 296 },
    { id: 206, left: 366, top: 128 }, { id: 200, left: 564, top: 338 },
    { id: 202, left: 498, top: 170 }, { id: 207, left: 542, top: 254 },
    { id: 205, left: 234, top: 212 }
  ],
  "c906": [
    { id: 209, left: 212, top: 170 }, { id: 205, left: 102, top: 128 },
    { id: 207, left: 190, top: 254 }, { id: 202, left: 146, top: 254 },
    { id: 201, left: 454, top: 338 }
  ]
};

const falseComponents = [
  [{ id: 29, left: 471, top: 291 }, { id: 33, left: 388, top: 170 }],
  [{ id: 71, left: 453, top: 296 }, { id: 72, left: 366, top: 296 }],
  [{ id: 71, left: 427, top: 258 }, { id: 73, left: 366, top: 254 }],
  [{ id: 71, left: 471, top: 254 }, { id: 74, left: 366, top: 254 }],
  [{ id: 79, left: 414, top: 216 }, { id: 83, left: 366, top: 212 }],
  [{ id: 71, left: 365, top: 299 }, { id: 129, left: 304, top: 264 }],
  [{ id: 71, left: 449, top: 301 }, { id: 129, left: 304, top: 264 }],
  [{ id: 71, left: 346, top: 335 }, { id: 129, left: 304, top: 264 }],
  [{ id: 88, left: 305, top: 255 }, { id: 133, left: 300, top: 214 }],
  [{ id: 88, left: 362, top: 293 }, { id: 133, left: 300, top: 214 }],
  [{ id: 88, left: 342, top: 255 }, { id: 133, left: 300, top: 214 }]
];

const falseRatios = [];
for (const [candidate, accepted] of falseComponents) {
  falseRatios.push({
    pair: `${candidate.id} in ${accepted.id}`,
    ratio: templateEmbeddingRatio(await record(candidate), await record(accepted))
  });
}
const weakestFalseComponent = Math.min(...falseRatios.map(({ ratio }) => ratio));
if (weakestFalseComponent < EMBEDDED_COMPONENT_THRESHOLD) {
  throw new Error(`A known composite component fell below the embedding threshold: ${JSON.stringify(falseRatios)}`);
}

let strongestRealOverlap = 0;
for (const [name, placements] of Object.entries(realScenes)) {
  const sceneRecords = await Promise.all(placements.map(record));
  const ratios = [];
  for (const candidate of sceneRecords) {
    for (const accepted of sceneRecords) {
      if (candidate === accepted) continue;
      ratios.push({
        pair: `${candidate.id} in ${accepted.id}`,
        ratio: templateEmbeddingRatio(candidate, accepted)
      });
    }
  }
  ratios.sort((left, right) => right.ratio - left.ratio);
  strongestRealOverlap = Math.max(strongestRealOverlap, ...ratios.map(({ ratio }) => ratio));
  if (ratios.some(({ ratio }) => ratio >= EMBEDDED_COMPONENT_THRESHOLD)) {
    throw new Error(`A real ${name} obstacle pair was misclassified as embedded: ${JSON.stringify(ratios)}`);
  }
}

console.log(
  `Template overlap regression passed: false components >= ${weakestFalseComponent.toFixed(3)}, `
  + `real Wasteland pairs <= ${strongestRealOverlap.toFixed(3)}.`
);
