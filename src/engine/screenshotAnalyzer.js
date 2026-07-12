import { createBattleStack, setSetupStackCount } from "./battleState.js";
import { createObstacleInstance, obstacleBlockedHexes } from "./obstacles.js";

const WIDTH = 800;
const HEIGHT = 556;

export async function analyzeBattlefieldScreenshot(file, data) {
  const source = await createImageBitmap(file);
  const screenshotCanvas = normalizeBattlefield(source);
  const screenshot = screenshotCanvas.getContext("2d", { willReadFrequently: true });
  const backgroundId = identifyBackground(screenshotCanvas, data.backgrounds);
  const background = data.backgrounds.find((candidate) => candidate.id === backgroundId);
  const backgroundImage = await loadImage(`./public/${background.image}`);
  const backgroundCanvas = drawToCanvas(backgroundImage, WIDTH, HEIGHT);
  const terrain = inferTerrain(background);

  const obstacles = await detectObstacles(screenshot, data, terrain);
  const blocked = new Set(obstacles.flatMap((obstacle) => obstacle.blockedHexIds));
  const stacks = await detectStacks(screenshot, backgroundCanvas.getContext("2d", { willReadFrequently: true }), data, blocked);
  const recognizedCounts = await applyNativeOcrCounts(screenshotCanvas, stacks, data.battlefield.grid);
  return {
    backgroundId,
    obstacles,
    stacks,
    note: recognizedCounts
      ? `${recognizedCounts} stack counts were read by native OCR; review low-confidence candidates before battle.`
      : "Unit counts default to 1 when native OCR is unavailable or screenshot digits cannot be classified reliably; review imported stacks before battle."
  };
}

function normalizeBattlefield(image) {
  const targetRatio = WIDTH / HEIGHT;
  const sourceRatio = image.width / image.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;
  if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio;
  } else if (sourceRatio < targetRatio) {
    sh = image.width / targetRatio;
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, WIDTH, HEIGHT);
  return canvas;
}

function identifyBackground(canvas, backgrounds) {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 16;
  sampleCanvas.height = 11;
  sampleCanvas.getContext("2d").drawImage(canvas, 0, 0, 16, 11);
  const pixels = sampleCanvas.getContext("2d").getImageData(0, 0, 16, 11).data;
  let best = null;
  for (const background of backgrounds) {
    let error = 0;
    for (let index = 0, pixel = 0; index < background.fingerprint.length; index += 3, pixel += 4) {
      error += Math.abs(background.fingerprint[index] - pixels[pixel]);
      error += Math.abs(background.fingerprint[index + 1] - pixels[pixel + 1]);
      error += Math.abs(background.fingerprint[index + 2] - pixels[pixel + 2]);
    }
    if (!best || error < best.error) best = { id: background.id, error };
  }
  return best?.id || "cmbkgrtr";
}

async function detectObstacles(screenshot, data, terrain) {
  const definitions = data.obstacles.filter((obstacle) =>
    obstacle.allowedTerrains.includes(terrain) || obstacle.specialBattlefields.includes(terrain) || obstacle.category === terrain
  );
  const candidates = [];
  for (const definition of definitions) {
    const image = await loadImage(`./public/${definition.image}`);
    if (definition.absolute) {
      const score = templateScore(screenshot, image, definition.width, definition.height, 5);
      if (score > 0.7) candidates.push({ definition, anchorHexId: null, score });
      continue;
    }
    for (const anchor of data.battlefield.grid.hexes) {
      const blockedHexIds = obstacleBlockedHexes(data.battlefield.grid, definition, anchor.id);
      if (blockedHexIds.length !== definition.blockedTiles.length) continue;
      const x = Math.round(anchor.centerX - 22);
      const y = Math.round(anchor.centerY + 28 - image.height);
      const score = templateScore(screenshot, image, x, y, 4);
      if (score > 0.74) candidates.push({ definition, anchorHexId: anchor.id, score, blockedHexIds });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const accepted = [];
  const occupied = new Set();
  for (const candidate of candidates) {
    const blockedHexIds = candidate.blockedHexIds || obstacleBlockedHexes(data.battlefield.grid, candidate.definition, candidate.anchorHexId);
    if (blockedHexIds.some((hexId) => occupied.has(hexId))) continue;
    const instance = createObstacleInstance(data.battlefield.grid, candidate.definition, candidate.anchorHexId);
    instance.detectionConfidence = candidate.score;
    accepted.push(instance);
    blockedHexIds.forEach((hexId) => occupied.add(hexId));
    if (candidate.definition.absolute || accepted.length >= 12) break;
  }
  return accepted;
}

async function detectStacks(screenshot, background, data, blocked) {
  const templates = await Promise.all(data.creatures.map(async (creature) => ({
    creature,
    image: await loadImage(creature.asset.previewImage.startsWith("assets/") ? `./public/${creature.asset.previewImage}` : creature.asset.previewImage)
  })));
  const candidates = [];
  for (const hex of data.battlefield.grid.hexes) {
    if (blocked.has(hex.id)) continue;
    const residual = patchDifference(screenshot, background, hex.centerX - 26, hex.centerY - 42, 52, 58);
    if (residual < 0.12) continue;
    let best = null;
    for (const template of templates) {
      const score = templateScore(screenshot, template.image, Math.round(hex.centerX - 39), Math.round(hex.centerY - 66), 4, 78, 78);
      if (!best || score > best.score) best = { creature: template.creature, score };
    }
    if (best?.score > 0.48) candidates.push({ ...best, hex });
  }
  candidates.sort((left, right) => right.score - left.score);
  const accepted = [];
  const usedHexes = new Set();
  const slots = { player: 0, ai: 0 };
  for (const candidate of candidates) {
    if (usedHexes.has(candidate.hex.id)) continue;
    const owner = candidate.hex.centerX < WIDTH / 2 ? "player" : "ai";
    if (slots[owner] >= 7) continue;
    const stack = createBattleStack({
      creature: candidate.creature,
      owner,
      hexId: candidate.hex.id,
      count: 1,
      armySlot: slots[owner]++,
      createdAt: accepted.length
    });
    stack.detectionConfidence = candidate.score;
    accepted.push(stack);
    usedHexes.add(candidate.hex.id);
    for (const neighbor of candidate.hex.neighbors) {
      if (candidate.score < 0.62) usedHexes.add(neighbor);
    }
  }
  return accepted;
}

function templateScore(context, image, x, y, step = 4, width = image.width, height = image.height) {
  if (x >= WIDTH || y >= HEIGHT || x + width <= 0 || y + height <= 0) return 0;
  const template = drawToCanvas(image, width, height).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const screen = context.getImageData(Math.max(0, x), Math.max(0, y), Math.min(width, WIDTH - Math.max(0, x)), Math.min(height, HEIGHT - Math.max(0, y))).data;
  const offsetX = Math.max(0, -x);
  const offsetY = Math.max(0, -y);
  const sampleWidth = Math.min(width - offsetX, WIDTH - Math.max(0, x));
  const sampleHeight = Math.min(height - offsetY, HEIGHT - Math.max(0, y));
  let error = 0;
  let count = 0;
  for (let py = 0; py < sampleHeight; py += step) {
    for (let px = 0; px < sampleWidth; px += step) {
      const templateIndex = ((py + offsetY) * width + px + offsetX) * 4;
      const alpha = template[templateIndex + 3];
      if (alpha < 160) continue;
      const screenIndex = (py * sampleWidth + px) * 4;
      error += Math.abs(template[templateIndex] - screen[screenIndex]);
      error += Math.abs(template[templateIndex + 1] - screen[screenIndex + 1]);
      error += Math.abs(template[templateIndex + 2] - screen[screenIndex + 2]);
      count += 3;
    }
  }
  return count ? 1 - error / (count * 255) : 0;
}

function patchDifference(first, second, x, y, width, height) {
  const left = first.getImageData(Math.max(0, x), Math.max(0, y), width, height).data;
  const right = second.getImageData(Math.max(0, x), Math.max(0, y), width, height).data;
  let difference = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 4) {
    difference += Math.abs(left[index] - right[index]) + Math.abs(left[index + 1] - right[index + 1]) + Math.abs(left[index + 2] - right[index + 2]);
  }
  return difference / (Math.min(left.length, right.length) / 4 * 3 * 255);
}

function inferTerrain(background) {
  const text = `${background.id} ${background.name}`.toLowerCase();
  if (background.id === "cmbkcf") return "cursed_ground";
  if (background.id === "cmbkef") return "evil_fog";
  if (background.id === "cmbkff") return "fiery_fields";
  if (background.id === "cmbkhg") return "holy_ground";
  if (background.id === "cmbklp") return "lucid_pools";
  if (background.id === "cmbkmag" || background.id === "cmbkmc") return "magic_clouds";
  if (background.id === "cmbkrk") return "rocklands";
  if (background.id === "cmbkbch") return "sand_shore";
  if (background.id === "cmbkboat" || background.id === "cmbkdeck") return "ship";
  if (text.includes("snow") || text.includes("sn")) return "snow";
  if (text.includes("swamp") || text.includes("swmp")) return "swamp";
  if (text.includes("lava") || text.includes("fiery")) return "lava";
  if (text.includes("sand") || text.includes("des")) return "sand";
  if (text.includes("rough") || text.includes("rgh") || text.includes("rock")) return "rough";
  if (text.includes("sub")) return "subterra";
  if (text.includes("dirt") || text.includes("dr")) return "dirt";
  return "grass";
}

function drawToCanvas(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

async function applyNativeOcrCounts(canvas, stacks, grid) {
  if (!("TextDetector" in window) || !stacks.length) return 0;
  try {
    const detector = new window.TextDetector();
    const results = await detector.detect(canvas);
    let applied = 0;
    for (const result of results) {
      const match = String(result.rawValue || "").match(/^\s*(\d{1,4})\s*$/);
      if (!match) continue;
      const count = Number(match[1]);
      if (count < 1 || count > 9999) continue;
      const box = result.boundingBox;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const nearest = stacks.reduce((best, stack) => {
        const hex = grid.hexes.find((candidate) => candidate.id === stack.hexId);
        if (!hex) return best;
        const distance = Math.hypot(center.x - (hex.centerX + 18), center.y - (hex.centerY + 10));
        return !best || distance < best.distance ? { stack, distance } : best;
      }, null);
      if (nearest?.distance < 70 && nearest.stack.count === 1) {
        setSetupStackCount(nearest.stack, count);
        applied += 1;
      }
    }
    return applied;
  } catch {
    return 0;
  }
}
