import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const root = path.resolve(import.meta.dirname, "..");
const catalogPath = path.join(root, "public", "data", "battlefield-catalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

for (const obstacle of catalog.obstacles) {
  const image = await loadImage(fs.readFileSync(path.join(root, "public", obstacle.image)));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let weightedX = 0;
  let totalAlpha = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = pixels[(y * image.width + x) * 4 + 3];
      weightedX += x * alpha;
      totalAlpha += alpha;
    }
  }
  obstacle.visualCenterX = totalAlpha
    ? Number((weightedX / totalAlpha).toFixed(3))
    : Number((image.width / 2).toFixed(3));
}

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Updated visible-pixel centers for ${catalog.obstacles.length} obstacles.`);
