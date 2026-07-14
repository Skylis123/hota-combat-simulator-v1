const PORTRAIT_WIDTH = 58;
const PORTRAIT_HEIGHT = 64;
const NATIVE_REFERENCE_WIDTH = 1600;
const NATIVE_CARD_STEP = 80;
const NATIVE_BASELINE_WIDTH = 73;
const DEFAULT_CREATURE_THRESHOLD = 0.45;
const DEFAULT_MARGIN_THRESHOLD = 0.03;
const templatePromiseCache = new Map();

/**
 * Reads the native Heroes III combat timeline without relying on battlefield
 * sprite classification. The result is a prior for screenshotAnalyzer: card
 * owner, creature, count, and current/next-round segment.
 */
export async function detectTurnBarRoster(source, data, options = {}) {
  const canvas = drawSource(source);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const bars = detectCardBaselines(context, canvas.width, canvas.height);
  if (!bars.length) return emptyResult("No native turn-order cards were found.");

  const templates = await loadCreatureTemplates(data, options.loadImage);
  const digits = await loadDigitTemplates(data, options.loadImage);
  const roundBreakIndex = detectRoundBreak(bars);
  const creatureThreshold = options.creatureThreshold ?? DEFAULT_CREATURE_THRESHOLD;
  const marginThreshold = options.marginThreshold ?? DEFAULT_MARGIN_THRESHOLD;
  const entries = bars.map((bar, slotIndex) => {
    const owner = detectOwner(context, bar);
    const portrait = normalizedPortrait(context, bar);
    const observedVector = pixelVector(portrait, owner === "ai");
    const scores = templates
      .map((template) => ({
        creatureId: template.creature.creatureId,
        name: template.creature.name,
        score: correlation(observedVector, owner === "ai" ? template.grayVector : template.colorVector)
      }))
      .sort((left, right) => right.score - left.score);
    const best = scores[0];
    const margin = best ? best.score - (scores[1]?.score ?? -1) : 0;
    const countResult = readCardCount(context, bar, digits);
    return {
      slotIndex,
      segment: roundBreakIndex !== null && slotIndex >= roundBreakIndex ? "next" : "current",
      owner,
      creatureId: best?.creatureId ?? null,
      creatureName: best?.name ?? null,
      confidence: best?.score ?? 0,
      margin,
      count: countResult?.value ?? null,
      countConfidence: countResult?.score ?? 0,
      cardBounds: cardBounds(bar),
      alternatives: scores.slice(0, 4),
      _vector: observedVector
    };
  });

  applyClusterConsensus(entries, creatureThreshold, marginThreshold);
  for (const entry of entries) {
    // Unknown is safer than a plausible but unsupported creature. A later
    // battlefield pass can still use the alternatives as soft evidence.
    if (entry.confidence < creatureThreshold || entry.margin < marginThreshold) {
      entry.creatureId = null;
      entry.creatureName = null;
    }
    delete entry._vector;
  }

  return {
    detected: true,
    roundBreakIndex,
    entries,
    vocabulary: uniqueVocabulary(entries),
    lowerBoundRoster: lowerBoundRoster(entries),
    cardCount: entries.length,
    geometry: summarizeGeometry(bars, canvas.width)
  };
}

function emptyResult(note) {
  return {
    detected: false,
    roundBreakIndex: null,
    entries: [],
    vocabulary: [],
    lowerBoundRoster: [],
    cardCount: 0,
    geometry: null,
    note
  };
}

function drawSource(source) {
  const width = source.naturalWidth || source.videoWidth || source.width;
  const height = source.naturalHeight || source.videoHeight || source.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  return canvas;
}

function detectCardBaselines(context, width, height) {
  const startY = Math.floor(height * 0.78);
  const rows = height - startY;
  const pixels = context.getImageData(0, startY, width, rows).data;
  const mask = new Uint8Array(width * rows);
  for (let index = 0; index < mask.length; index += 1) {
    const pixel = index * 4;
    const red = pixels[pixel];
    const green = pixels[pixel + 1];
    const blue = pixels[pixel + 2];
    if (green > 70 && green > red * 1.3 && green > blue * 1.3) mask[index] = 1;
  }

  const visited = new Uint8Array(mask.length);
  const candidates = [];
  const minimumWidth = width * 0.025;
  const maximumWidth = width * 0.065;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let minX = width;
    let maxX = 0;
    let minY = rows;
    let maxY = 0;
    let area = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      area += 1;
      for (const neighbor of [index - 1, index + 1, index - width, index + width]) {
        if (neighbor < 0 || neighbor >= mask.length || visited[neighbor] || !mask[neighbor]) continue;
        if (Math.abs((neighbor % width) - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    if (
      componentWidth >= minimumWidth
      && componentWidth <= maximumWidth
      && componentHeight >= 2
      && componentHeight <= height * 0.015
      && area >= componentWidth * 1.5
    ) {
      candidates.push({ x: minX, y: minY + startY, width: componentWidth, height: componentHeight });
    }
  }
  if (!candidates.length) return [];

  let consensusY = candidates[0].y;
  let consensusSize = 0;
  for (const candidate of candidates) {
    const size = candidates.filter((other) => Math.abs(other.y - candidate.y) <= 2).length;
    if (size > consensusSize || (size === consensusSize && candidate.y > consensusY)) {
      consensusY = candidate.y;
      consensusSize = size;
    }
  }
  const aligned = candidates
    .filter((candidate) => Math.abs(candidate.y - consensusY) <= 2)
    .sort((left, right) => left.x - right.x)
    .slice(0, 15);
  if (aligned.length < 2 || consensusY < height * 0.84 || consensusY > height * 0.97) return [];
  const baselineWidth = median(aligned.map((candidate) => candidate.width));
  if (aligned.some((candidate) => Math.abs(candidate.width - baselineWidth) > baselineWidth * 0.15)) return [];
  const expectedStep = baselineWidth * NATIVE_CARD_STEP / NATIVE_BASELINE_WIDTH;
  const spacingIsNative = aligned.slice(1).every((candidate, index) => {
    const gap = candidate.x - aligned[index].x;
    return (gap >= expectedStep * 0.72 && gap <= expectedStep * 1.28)
      || (gap >= expectedStep * 1.7 && gap <= expectedStep * 2.3);
  });
  return spacingIsNative ? aligned : [];
}

function normalizedPortrait(context, bar) {
  // Derived from the detected native card itself. At 1600 px the baseline is
  // 72-73 px wide and the portrait occupies x+1..x+72, y-72..y+7.
  const sourceX = bar.x + Math.max(1, Math.round(bar.width * 0.014));
  const sourceY = bar.y - Math.round(bar.width * 72 / 73);
  const sourceWidth = Math.max(1, bar.width - Math.round(bar.width * 2 / 73));
  const sourceHeight = Math.round(bar.width * 79 / 73);
  const canvas = document.createElement("canvas");
  canvas.width = PORTRAIT_WIDTH;
  canvas.height = PORTRAIT_HEIGHT;
  const target = canvas.getContext("2d", { willReadFrequently: true });
  target.imageSmoothingEnabled = true;
  target.drawImage(context.canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
  return target.getImageData(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT).data;
}

function cardBounds(bar) {
  return {
    x: bar.x,
    y: bar.y - Math.round(bar.width * 72 / 73),
    width: bar.width,
    height: Math.round(bar.width * 1.48)
  };
}

function detectOwner(context, bar) {
  const x = bar.x + Math.round(bar.width * 0.08);
  const y = bar.y + bar.height + 2;
  const width = Math.max(1, bar.width - Math.round(bar.width * 0.16));
  const height = Math.max(1, Math.round(bar.width * 0.34));
  const pixels = context.getImageData(x, y, width, Math.min(height, context.canvas.height - y)).data;
  let redDominance = 0;
  let samples = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (red > 220 && green > 220 && blue > 220) continue;
    redDominance += red - (green + blue) / 2;
    samples += 1;
  }
  return samples && redDominance / samples > 50 ? "player" : "ai";
}

async function loadCreatureTemplates(data, loadImage) {
  return Promise.all(data.creatures.map(async (creature) => {
    const path = data.creatureDetection?.creatures?.[String(creature.creatureId)]?.queuePortrait;
    const image = path ? await loadAsset(path, loadImage) : null;
    const canvas = document.createElement("canvas");
    canvas.width = PORTRAIT_WIDTH;
    canvas.height = PORTRAIT_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (image) context.drawImage(image, 0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    const pixels = context.getImageData(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT).data;
    return {
      creature,
      colorVector: pixelVector(pixels, false),
      grayVector: pixelVector(pixels, true)
    };
  }));
}

async function loadDigitTemplates(data, loadImage) {
  const records = data.creatureDetection?.digits?.tiny || [];
  return Promise.all(records.map(async (record) => {
    const image = await loadAsset(record.image, loadImage);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const points = [];
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
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
    return { digit: Number(record.digit), width, height, mask };
  }));
}

function readCardCount(context, bar, digits) {
  if (!digits.length) return null;
  const x = bar.x + Math.round(bar.width * 10 / 73);
  const y = bar.y + bar.height + Math.round(bar.width * 3 / 73);
  const width = Math.round(bar.width * 53 / 73);
  const height = Math.min(Math.round(bar.width * 21 / 73), context.canvas.height - y);
  if (width <= 0 || height <= 0) return null;
  const pixels = context.getImageData(x, y, width, height).data;
  const white = new Uint8Array(width * height);
  for (let index = 0; index < white.length; index += 1) {
    const pixel = index * 4;
    if (pixels[pixel] > 145 && pixels[pixel + 1] > 145 && pixels[pixel + 2] > 145) white[index] = 1;
  }
  const points = [];
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (!white[py * width + px]) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = px + dx;
          const ny = py + dy;
          if ((dx || dy) && nx >= 0 && nx < width && ny >= 0 && ny < height && white[ny * width + nx]) neighbors += 1;
        }
      }
      if (neighbors) points.push([px, py]);
    }
  }
  if (!points.length) return null;
  const minX = Math.min(...points.map(([px]) => px));
  const maxX = Math.max(...points.map(([px]) => px));
  const minY = Math.min(...points.map(([, py]) => py));
  const maxY = Math.max(...points.map(([, py]) => py));
  const actualWidth = maxX - minX + 1;
  const actualHeight = maxY - minY + 1;
  if (actualWidth > width * 0.75 || actualHeight < 4) return null;
  const actual = new Uint8Array(actualWidth * actualHeight);
  for (const [px, py] of points) actual[(py - minY) * actualWidth + px - minX] = 1;
  let best = null;
  let second = null;
  for (let value = 1; value <= 9999; value += 1) {
    const glyphs = String(value).split("").map((character) => digits[Number(character)]);
    const baseWidth = glyphs.reduce((sum, glyph) => sum + glyph.width, 0) + glyphs.length - 1;
    const baseHeight = Math.max(...glyphs.map((glyph) => glyph.height));
    const scale = actualHeight / baseHeight;
    if (Math.abs(baseWidth * scale - actualWidth) > Math.max(3, scale * 1.5)) continue;
    const candidate = composeGlyphs(glyphs, baseWidth, baseHeight);
    const score = resizedMaskIoU(actual, actualWidth, actualHeight, candidate, baseWidth, baseHeight);
    const result = { value, score };
    if (!best || score > best.score) {
      second = best;
      best = result;
    } else if (!second || score > second.score) second = result;
  }
  if (!best || best.score < 0.42 || best.score - (second?.score ?? 0) < 0.025) return null;
  return best;
}

function composeGlyphs(glyphs, width, height) {
  const result = new Uint8Array(width * height);
  let offsetX = 0;
  for (const glyph of glyphs) {
    for (let y = 0; y < glyph.height; y += 1) {
      for (let x = 0; x < glyph.width; x += 1) {
        if (glyph.mask[y * glyph.width + x]) result[y * width + offsetX + x] = 1;
      }
    }
    offsetX += glyph.width + 1;
  }
  return result;
}

function resizedMaskIoU(actual, actualWidth, actualHeight, expected, expectedWidth, expectedHeight) {
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < actualHeight; y += 1) {
    for (let x = 0; x < actualWidth; x += 1) {
      const expectedX = Math.min(expectedWidth - 1, Math.floor(x * expectedWidth / actualWidth));
      const expectedY = Math.min(expectedHeight - 1, Math.floor(y * expectedHeight / actualHeight));
      const observed = actual[y * actualWidth + x];
      const predicted = expected[expectedY * expectedWidth + expectedX];
      if (observed && predicted) intersection += 1;
      if (observed || predicted) union += 1;
    }
  }
  return union ? intersection / union : 0;
}

function pixelVector(pixels, grayscale) {
  const values = new Float32Array(PORTRAIT_WIDTH * PORTRAIT_HEIGHT * (grayscale ? 1 : 3));
  let cursor = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (grayscale) values[cursor++] = red * 0.299 + green * 0.587 + blue * 0.114;
    else {
      values[cursor++] = red;
      values[cursor++] = green;
      values[cursor++] = blue;
    }
  }
  return normalizeVector(values);
}

function normalizeVector(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let norm = 0;
  for (let index = 0; index < values.length; index += 1) {
    values[index] -= mean;
    norm += values[index] * values[index];
  }
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < values.length; index += 1) values[index] /= norm;
  return values;
}

function correlation(left, right) {
  if (!left || !right || left.length !== right.length) return -1;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index];
  return result;
}

function applyClusterConsensus(entries, creatureThreshold, marginThreshold) {
  const clusters = [];
  for (const entry of entries) {
    let cluster = clusters.find((candidate) =>
      candidate.owner === entry.owner && correlation(candidate.prototype, entry._vector) >= 0.88
    );
    if (!cluster) {
      cluster = { owner: entry.owner, prototype: entry._vector, entries: [] };
      clusters.push(cluster);
    }
    cluster.entries.push(entry);
  }
  for (const cluster of clusters) {
    if (cluster.entries.length < 2) continue;
    const aggregate = new Map();
    for (const entry of cluster.entries) {
      for (const alternative of entry.alternatives) {
        const record = aggregate.get(alternative.creatureId) || { score: 0, name: alternative.name };
        record.score += alternative.score;
        aggregate.set(alternative.creatureId, record);
      }
    }
    const ranked = [...aggregate.entries()]
      .map(([creatureId, record]) => ({ creatureId, name: record.name, score: record.score / cluster.entries.length }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const margin = best ? best.score - (ranked[1]?.score ?? -1) : 0;
    if (!best || best.score < creatureThreshold || margin < marginThreshold) continue;
    for (const entry of cluster.entries) {
      entry.creatureId = best.creatureId;
      entry.creatureName = best.name;
      entry.confidence = best.score;
      entry.margin = margin;
    }
  }
}

function detectRoundBreak(bars) {
  if (bars.length < 2) return null;
  const baselineWidth = median(bars.map((bar) => bar.width));
  const expectedStep = baselineWidth * NATIVE_CARD_STEP / NATIVE_BASELINE_WIDTH;
  for (let index = 1; index < bars.length; index += 1) {
    // The round tile has no green baseline. Consecutive creature cards are
    // 80 px apart in a native 1600 px screenshot, while crossing the round
    // tile produces a gap of roughly two card steps.
    if (bars[index].x - bars[index - 1].x > expectedStep * 1.45) return index;
  }
  return null;
}

function summarizeGeometry(bars, sourceWidth) {
  const baselineWidth = median(bars.map((bar) => bar.width));
  return {
    sourceWidth,
    referenceWidth: NATIVE_REFERENCE_WIDTH,
    scale: baselineWidth / NATIVE_BASELINE_WIDTH,
    cardStep: baselineWidth * NATIVE_CARD_STEP / NATIVE_BASELINE_WIDTH,
    firstCardX: bars[0]?.x ?? null,
    baselineY: median(bars.map((bar) => bar.y))
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function uniqueVocabulary(entries) {
  const values = new Map();
  for (const entry of entries) {
    if (entry.creatureId === null) continue;
    values.set(`${entry.owner}:${entry.creatureId}`, {
      owner: entry.owner,
      creatureId: entry.creatureId,
      creatureName: entry.creatureName
    });
  }
  return [...values.values()];
}

function lowerBoundRoster(entries) {
  const segments = new Map();
  for (const entry of entries) {
    if (entry.creatureId === null) continue;
    const key = `${entry.owner}:${entry.creatureId}:${entry.count ?? "?"}`;
    const segmentKey = `${entry.segment}:${key}`;
    segments.set(segmentKey, (segments.get(segmentKey) || 0) + 1);
  }
  const roster = new Map();
  for (const [segmentKey, instances] of segments) {
    const separator = segmentKey.indexOf(":");
    const key = segmentKey.slice(separator + 1);
    roster.set(key, Math.max(roster.get(key) || 0, instances));
  }
  return [...roster.entries()].map(([key, instances]) => {
    const [owner, creatureId, count] = key.split(":");
    const entry = entries.find((candidate) =>
      candidate.owner === owner
      && String(candidate.creatureId) === creatureId
      && String(candidate.count ?? "?") === count
    );
    return {
      owner,
      creatureId: Number(creatureId),
      creatureName: entry?.creatureName,
      count: count === "?" ? null : Number(count),
      instances
    };
  });
}

function loadAsset(path, customLoader) {
  const key = `${customLoader ? "custom" : "default"}:${path}`;
  if (!templatePromiseCache.has(key)) {
    templatePromiseCache.set(key, customLoader ? customLoader(path) : new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `./public/${path}`;
    }));
  }
  return templatePromiseCache.get(key);
}
