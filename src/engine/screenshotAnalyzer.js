import { createBattleStack, setSetupStackCount } from "./battleState.js";
import { createObstacleInstance, obstacleBlockedHexes } from "./obstacles.js";
import { inferAbilityFlags } from "./abilities.js";
import { footprintHexes } from "./footprint.js";

const WIDTH = 800;
const HEIGHT = 556;
const contextPixelCache = new WeakMap();
const templatePixelCache = new WeakMap();

export async function analyzeBattlefieldScreenshot(file, data) {
  const source = await createImageBitmap(file);
  const screenshotCanvas = normalizeBattlefield(source);
  const screenshot = screenshotCanvas.getContext("2d", { willReadFrequently: true });
  const backgroundId = identifyBackground(screenshotCanvas, data.backgrounds);
  const background = data.backgrounds.find((candidate) => candidate.id === backgroundId);
  const backgroundImage = await loadImage(`./public/${background.image}`);
  const backgroundCanvas = drawToCanvas(backgroundImage, WIDTH, HEIGHT);
  const backgroundContext = backgroundCanvas.getContext("2d", { willReadFrequently: true });
  const terrain = inferTerrain(background);

  const obstacles = await detectObstacles(screenshot, backgroundContext, data, terrain);
  const blocked = new Set(obstacles.flatMap((obstacle) => obstacle.blockedHexIds));
  const stacks = await detectStacks(screenshot, backgroundContext, data, blocked);
  const recognizedCounts = await applyNativeOcrCounts(screenshotCanvas, stacks, data.battlefield.grid);
  const bitmapCounts = stacks.filter((stack) => stack.screenshotCountRecognized).length;
  return {
    backgroundId,
    obstacles,
    stacks,
    note: recognizedCounts + bitmapCounts
      ? `${recognizedCounts + bitmapCounts} stack counts were read automatically.`
      : "Creature and obstacle recognition uses original game frames. Counts that cannot be read confidently remain 1 and can be edited with right-click."
  };
}

function normalizeBattlefield(image) {
  const targetRatio = WIDTH / HEIGHT;
  const sourceRatio = image.width / image.height;
  let sw = image.width;
  let sh = image.height;
  if (sourceRatio > targetRatio) sw = image.height * targetRatio;
  else if (sourceRatio < targetRatio) sh = image.width / targetRatio;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.getContext("2d").drawImage(image, 0, 0, sw, sh, 0, 0, WIDTH, HEIGHT);
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

async function detectObstacles(screenshot, background, data, terrain) {
  const definitions = data.obstacles.filter((obstacle) =>
    obstacle.allowedTerrains.includes(terrain) || obstacle.specialBattlefields.includes(terrain) || obstacle.category === terrain
  );
  const images = new Map();
  for (const definition of definitions) images.set(definition.id, await loadImage(`./public/${definition.image}`));
  const candidates = [];

  for (const definition of definitions.filter((candidate) => candidate.absolute)) {
    const image = images.get(definition.id);
    const placement = bestCompositePlacement(screenshot, background, image, definition.width, definition.height, {
      radiusX: 28, radiusY: 28, step: 4, allowFlip: true, sampleStep: 3
    });
    if (placement.correlation > 0.45 && placement.match > 0.82) candidates.push({ definition, anchorHexId: null, ...placement });
  }

  for (const definition of definitions.filter((candidate) => !candidate.absolute)) {
    const image = images.get(definition.id);
    for (const anchor of data.battlefield.grid.hexes) {
      const blockedHexIds = obstacleBlockedHexes(data.battlefield.grid, definition, anchor.id);
      if (blockedHexIds.length !== definition.blockedTiles.length) continue;
      const placement = bestCompositePlacement(screenshot, background, image, Math.round(anchor.centerX - 22), Math.round(anchor.centerY + 50 - image.height), {
        radiusX: 9, radiusY: 5, step: 2, allowFlip: false, sampleStep: 3
      });
      if (placement.correlation > 0.5 && placement.gain > 0.12 && placement.match > 0.72) candidates.push({ definition, anchorHexId: anchor.id, blockedHexIds, ...placement });
    }
  }

  candidates.sort((left, right) => (right.definition.absolute - left.definition.absolute) || (right.gain - left.gain));
  const accepted = [];
  const occupied = new Set();
  for (const candidate of candidates) {
    const blockedHexIds = candidate.blockedHexIds || obstacleBlockedHexes(data.battlefield.grid, candidate.definition, candidate.anchorHexId);
    if (blockedHexIds.some((hexId) => occupied.has(hexId))) continue;
    if (candidate.definition.absolute && accepted.some((item) => item.absolute)) continue;
    const instance = createObstacleInstance(data.battlefield.grid, candidate.definition, candidate.anchorHexId);
    instance.detectionConfidence = candidate.gain;
    instance.detectedFlip = candidate.flip;
    accepted.push(instance);
    blockedHexIds.forEach((hexId) => occupied.add(hexId));
    if (accepted.length >= 12) break;
  }
  return accepted;
}

async function detectStacks(screenshot, background, data, blocked) {
  const templates = [];
  for (const creature of data.creatures) {
    const records = data.creatureDetection?.creatures?.[String(creature.creatureId)]?.frames || [];
    for (const record of records) {
      templates.push({ creature, record, image: await loadImage(`./public/${record.image}`) });
    }
  }

  const candidates = [];
  const badges = detectStackBadges(screenshot);
  const digitTemplates = await loadDigitTemplates(data);
  for (const badge of badges) badge.count = readBadgeCount(screenshot, badge, digitTemplates);
  for (const badge of badges) {
    const nearbyHexes = data.battlefield.grid.hexes.filter((hex) => !blocked.has(hex.id));
    let best = null;
    const bestByCreature = new Map();
    for (const hex of nearbyHexes) {
      for (const template of templates) {
        const twoHex = inferAbilityFlags(template.creature).twoHex;
        const aiSide = hex.centerX >= WIDTH / 2;
        const expectedBadgeX = twoHex ? hex.centerX + (aiSide ? -44 : 75) : hex.centerX + 31;
        const expectedBadgeY = hex.centerY + (twoHex && aiSide ? 16 : 32);
        if (Math.abs(expectedBadgeX - badge.centerX) > 16 || Math.abs(expectedBadgeY - badge.centerY) > 16) continue;
        // Heroes III draws the 450x400 DEF canvas from a fixed battle-stack anchor.
        // Preserve the frame's internal left/top offsets; centering the cropped PNG
        // lets a large neighboring creature win the score for the wrong hex.
        const baseX = Math.round(hex.centerX - 202 + template.record.left);
        const baseY = Math.round(hex.centerY - 226 + template.record.top);
        const placement = bestCompositePlacement(screenshot, background, template.image, baseX, baseY, {
          radiusX: 2, radiusY: 2, step: 2, allowFlip: true, sampleStep: 2
        });
        const quality = Math.max(0, placement.correlation) * 0.55 + placement.chroma * 0.3 + Math.max(0, placement.gain) * 0.15;
        const candidate = { creature: template.creature, quality, hex, ...placement };
        const previous = bestByCreature.get(template.creature.creatureId);
        if (!previous || quality > previous.quality) bestByCreature.set(template.creature.creatureId, candidate);
        if (!best || quality > best.quality) best = candidate;
      }
    }
    if (best?.creature.creatureId % 2 === 1) {
      const baseCreature = bestByCreature.get(best.creature.creatureId - 1);
      if (baseCreature && baseCreature.quality >= best.quality - 0.06) best = baseCreature;
    }
    if (best?.correlation > 0.13 && best.chroma > 0.82 && best.quality > 0.34) candidates.push({ ...best, badge });
  }

  candidates.sort((left, right) => right.quality - left.quality);
  const accepted = [];
  const usedHexes = new Set();
  const slots = { player: 0, ai: 0 };
  for (const candidate of candidates) {
    if (usedHexes.has(candidate.hex.id)) continue;
    const owner = candidate.hex.centerX < WIDTH / 2 ? "player" : "ai";
    if (slots[owner] >= 7) continue;
    let primaryHex = candidate.hex;
    if (inferAbilityFlags(candidate.creature).twoHex && owner === "player") {
      primaryHex = data.battlefield.grid.hexes.find((hex) => hex.row === candidate.hex.row && hex.col === candidate.hex.col + 1) || candidate.hex;
    }
    const stack = createBattleStack({
      creature: candidate.creature,
      owner,
      hexId: primaryHex.id,
      count: candidate.badge.count || 1,
      armySlot: slots[owner]++,
      createdAt: accepted.length
    });
    stack.detectionConfidence = candidate.quality;
    stack.screenshotCountRecognized = Boolean(candidate.badge.count);
    accepted.push(stack);
    for (const occupiedHexId of footprintHexes(data.battlefield.grid, stack) || [candidate.hex.id]) {
      usedHexes.add(occupiedHexId);
    }
  }
  return accepted;
}

async function loadDigitTemplates(data) {
  const records = data.creatureDetection?.digits?.tiny || [];
  return Promise.all(records.map(async (record) => {
    const image = await loadImage(`./public/${record.image}`);
    const canvas = drawToCanvas(image, image.width, image.height);
    const pixels = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, image.width, image.height).data;
    const points = [];
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const index = (y * image.width + x) * 4;
        if (pixels[index + 3] > 0 && pixels[index] > 180) points.push([x, y]);
      }
    }
    const minX = Math.min(...points.map(([x]) => x));
    const maxX = Math.max(...points.map(([x]) => x));
    const minY = Math.min(...points.map(([, y]) => y));
    const maxY = Math.max(...points.map(([, y]) => y));
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const mask = new Uint8Array(width * height);
    for (const [x, y] of points) mask[(y - minY) * width + x - minX] = 1;
    return { digit: record.digit, width, height, mask };
  }));
}

function readBadgeCount(context, badge, digits) {
  if (!digits.length) return null;
  const pixels = contextPixels(context);
  const points = [];
  for (let y = badge.minY; y < badge.minY + badge.height; y += 1) {
    for (let x = badge.minX; x < badge.minX + badge.width; x += 1) {
      const index = (y * WIDTH + x) * 4;
      if (pixels[index] > 145 && pixels[index + 1] > 145 && pixels[index + 2] > 145) points.push([x, y]);
    }
  }
  const filteredPoints = points.filter(([x, y]) => points.some(([otherX, otherY]) =>
    (otherX !== x || otherY !== y) && Math.abs(otherX - x) <= 1 && Math.abs(otherY - y) <= 1
  ));
  if (!filteredPoints.length) return null;
  const minX = Math.min(...filteredPoints.map(([x]) => x));
  const maxX = Math.max(...filteredPoints.map(([x]) => x));
  const minY = Math.min(...filteredPoints.map(([, y]) => y));
  const maxY = Math.max(...filteredPoints.map(([, y]) => y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width > 22 || height > 9) return null;
  const actual = new Uint8Array(width * height);
  for (const [x, y] of filteredPoints) actual[(y - minY) * width + x - minX] = 1;
  let best = null;
  for (let value = 1; value <= 999; value += 1) {
    const glyphs = String(value).split("").map((character) => digits[Number(character)]);
    const candidateWidth = glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + glyphs.length - 1;
    const candidateHeight = Math.max(...glyphs.map((glyph) => glyph.height));
    if (Math.abs(candidateWidth - width) > 2 || Math.abs(candidateHeight - height) > 2) continue;
    const candidate = new Uint8Array(candidateWidth * candidateHeight);
    let offsetX = 0;
    for (const glyph of glyphs) {
      for (let y = 0; y < glyph.height; y += 1) {
        for (let x = 0; x < glyph.width; x += 1) {
          if (glyph.mask[y * glyph.width + x]) candidate[y * candidateWidth + offsetX + x] = 1;
        }
      }
      offsetX += glyph.width + 1;
    }
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        let intersection = 0;
        let union = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const expectedX = x - dx;
            const expectedY = y - dy;
            const expected = expectedX >= 0 && expectedY >= 0 && expectedX < candidateWidth && expectedY < candidateHeight
              ? candidate[expectedY * candidateWidth + expectedX]
              : 0;
            const observed = actual[y * width + x];
            if (expected && observed) intersection += 1;
            if (expected || observed) union += 1;
          }
        }
        const score = union ? intersection / union : 0;
        if (!best || score > best.score) best = { value, score };
      }
    }
  }
  return best?.score >= 0.4 ? best.value : null;
}

function detectStackBadges(context) {
  const pixels = contextPixels(context);
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x;
      const pixel = index * 4;
      const red = pixels[pixel];
      const green = pixels[pixel + 1];
      const blue = pixels[pixel + 2];
      if (red >= 55 && red <= 220 && green <= 130 && blue >= 80 && blue >= green * 1.15 && red >= green * 0.8) mask[index] = 1;
    }
  }
  const visited = new Uint8Array(mask.length);
  const badges = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let minX = WIDTH;
    let maxX = 0;
    let minY = HEIGHT;
    let maxY = 0;
    let area = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % WIDTH;
      const y = Math.floor(index / WIDTH);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      area += 1;
      for (const neighbor of [index - 1, index + 1, index - WIDTH, index + WIDTH]) {
        if (neighbor < 0 || neighbor >= mask.length || visited[neighbor] || !mask[neighbor]) continue;
        const nx = neighbor % WIDTH;
        if (Math.abs(nx - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (area >= 40 && width >= 15 && width <= 48 && height >= 5 && height <= 20) {
      badges.push({ minX, minY, width, height, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 });
    }
  }
  return badges;
}

function bestCompositePlacement(screen, background, image, originX, originY, options) {
  let best = { gain: -1, match: 0, correlation: -1, chroma: 0, x: originX, y: originY, flip: false };
  const flips = options.allowFlip ? [false, true] : [false];
  for (const flip of flips) {
    for (let dy = -options.radiusY; dy <= options.radiusY; dy += options.step) {
      for (let dx = -options.radiusX; dx <= options.radiusX; dx += options.step) {
        const score = compositeScore(screen, background, image, originX + dx, originY + dy, flip, options.sampleStep);
        if (score.correlation > best.correlation || (score.correlation === best.correlation && score.gain > best.gain)) {
          best = { ...score, x: originX + dx, y: originY + dy, flip };
        }
      }
    }
  }
  return best;
}

function compositeScore(screenContext, backgroundContext, image, x, y, flip, step) {
  if (x >= WIDTH || y >= HEIGHT || x + image.width <= 0 || y + image.height <= 0) {
    return { gain: -1, match: 0, correlation: -1, chroma: 0 };
  }
  let variants = templatePixelCache.get(image);
  if (!variants) {
    variants = new Map();
    templatePixelCache.set(image, variants);
  }
  if (!variants.has(flip)) {
    const templateCanvas = drawToCanvas(image, image.width, image.height, flip);
    variants.set(flip, templateCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, image.width, image.height).data);
  }
  const template = variants.get(flip);
  const screen = contextPixels(screenContext);
  const background = contextPixels(backgroundContext);
  let baselineError = 0;
  let candidateError = 0;
  let samples = 0;
  let screenSum = 0;
  let templateSum = 0;
  let screenSquareSum = 0;
  let templateSquareSum = 0;
  let productSum = 0;
  const screenRgb = [0, 0, 0];
  const templateRgb = [0, 0, 0];
  for (let py = 0; py < image.height; py += step) {
    const sy = y + py;
    if (sy < 0 || sy >= HEIGHT) continue;
    for (let px = 0; px < image.width; px += step) {
      const sx = x + px;
      if (sx < 0 || sx >= WIDTH) continue;
      const ti = (py * image.width + px) * 4;
      const alpha = template[ti + 3] / 255;
      if (alpha < 0.3) continue;
      const si = (sy * WIDTH + sx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = background[si + channel];
        const expected = template[ti + channel] * alpha + base * (1 - alpha);
        baselineError += Math.abs(screen[si + channel] - base);
        candidateError += Math.abs(screen[si + channel] - expected);
        const actual = screen[si + channel];
        const reference = template[ti + channel];
        screenSum += actual;
        templateSum += reference;
        screenSquareSum += actual * actual;
        templateSquareSum += reference * reference;
        productSum += actual * reference;
        screenRgb[channel] += actual;
        templateRgb[channel] += reference;
      }
      samples += 3;
    }
  }
  if (!samples || baselineError < samples * 2) return { gain: -1, match: 0, correlation: -1, chroma: 0 };
  const covariance = productSum - screenSum * templateSum / samples;
  const screenVariance = screenSquareSum - screenSum * screenSum / samples;
  const templateVariance = templateSquareSum - templateSum * templateSum / samples;
  const correlation = covariance / Math.sqrt(Math.max(1, screenVariance * templateVariance));
  const screenTotal = screenRgb.reduce((sum, value) => sum + value, 0) || 1;
  const templateTotal = templateRgb.reduce((sum, value) => sum + value, 0) || 1;
  const chroma = 1 - screenRgb.reduce((error, value, channel) => error + Math.abs(value / screenTotal - templateRgb[channel] / templateTotal), 0) / 3;
  return {
    gain: (baselineError - candidateError) / baselineError,
    match: 1 - candidateError / (samples * 255),
    correlation,
    chroma
  };
}

function contextPixels(context) {
  if (!contextPixelCache.has(context)) contextPixelCache.set(context, context.getImageData(0, 0, WIDTH, HEIGHT).data);
  return contextPixelCache.get(context);
}

function patchDifference(first, second, x, y, width, height) {
  const safeX = Math.max(0, Math.round(x));
  const safeY = Math.max(0, Math.round(y));
  const safeWidth = Math.min(Math.round(width), WIDTH - safeX);
  const safeHeight = Math.min(Math.round(height), HEIGHT - safeY);
  const left = first.getImageData(safeX, safeY, safeWidth, safeHeight).data;
  const right = second.getImageData(safeX, safeY, safeWidth, safeHeight).data;
  let difference = 0;
  for (let index = 0; index < left.length; index += 4) {
    difference += Math.abs(left[index] - right[index]) + Math.abs(left[index + 1] - right[index + 1]) + Math.abs(left[index + 2] - right[index + 2]);
  }
  return difference / (left.length / 4 * 3 * 255);
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

function drawToCanvas(image, width, height, flip = false) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (flip) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(image, 0, 0, width, height);
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
      if (nearest?.distance < 70 && nearest.stack.count === 1 && !nearest.stack.screenshotCountRecognized) {
        setSetupStackCount(nearest.stack, count);
        applied += 1;
      }
    }
    return applied;
  } catch {
    return 0;
  }
}
