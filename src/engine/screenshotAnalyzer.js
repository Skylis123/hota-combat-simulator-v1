import { createBattleStack } from "./battleState.js";
import { canPlaceObstacle, createObstacleInstance, detectedObstacleBlockedHexes, obstacleBlockedHexes, obstacleNativePosition } from "./obstacles.js";
import { inferAbilityFlags } from "./abilities.js";
import { footprintHexes } from "./footprint.js";
import { detectBattleWindowBounds, detectTurnBarRoster } from "./turnBarAnalyzer.js";
import { assignImportedArmySlots } from "./importArmyOrder.js";
import { templateEmbeddingRatio } from "./templateOverlap.js";

const WIDTH = 800;
const HEIGHT = 556;
const BATTLE_CONTENT_OFFSET_X = 8;
const BATTLE_CONTENT_OFFSET_Y = 7;
const BATTLE_CONTENT_REFERENCE_WIDTH = 1600;
const BATTLE_CONTENT_REFERENCE_HEIGHT = 1112;
const CREATURE_CANVAS_ANCHOR_X = 196;
const CREATURE_CANVAS_ANCHOR_Y = 251;
const ROSTER_VISUAL_QUALITY_TOLERANCE = 0.04;
const BACKGROUND_TERRAIN_BY_ID = new Map([
  ["cmbkbch", "sand_shore"],
  ["cmbkboat", "ship"],
  ["cmbkcf", "clover_field"],
  ["cmbkcur", "cursed_ground"],
  ["cmbkdeck", "ship"],
  ["cmbkdes", "sand"],
  ["cmbkdrdd", "dirt"],
  ["cmbkdrmt", "dirt"],
  ["cmbkdrtr", "dirt"],
  ["cmbkef", "evil_fog"],
  ["cmbkff", "fiery_fields"],
  ["cmbkfw", "favorable_winds"],
  ["cmbkgrmt", "grass"],
  ["cmbkgrtr", "grass"],
  ["cmbkhg", "holy_ground"],
  ["cmbklp", "lucid_pools"],
  ["cmbklava", "lava"],
  ["cmbkmc", "magic_clouds"],
  ["cmbkmag", "magic_plains"],
  ["cmbkrk", "rocklands"],
  ["cmbkrgh", "rough"],
  ["cmbksnmt", "snow"],
  ["cmbksntr", "snow"],
  ["cmbksub", "subterra"],
  ["cmbkswmp", "swamp"],
  ["wasteland_rocks", "wasteland"]
]);
const BACKGROUND_FINGERPRINT = { x: 96, y: 0, width: 704, height: 104, sampleWidth: 64, sampleHeight: 8 };
const contextPixelCache = new WeakMap();
const templatePixelCache = new WeakMap();
const templateAlphaDensityCache = new WeakMap();
const scaledCreatureTemplateCache = new WeakMap();
const imagePromiseCache = new Map();

export async function analyzeBattlefieldScreenshot(file, data) {
  const startedAt = performance.now();
  const source = await createImageBitmap(file);
  const battleWindow = detectBattleWindowBounds(source);
  // The native queue is outside the normalized battlefield crop, so start
  // reading it from the full screenshot while background preparation runs.
  const turnRosterPromise = detectTurnBarRoster(source, data).catch((error) => ({
    detected: false,
    lowerBoundRoster: [],
    entries: [],
    note: `Turn-bar analysis was skipped: ${error.message}`
  }));
  const screenshotCanvas = normalizeBattlefield(source, true, battleWindow);
  const countCanvas = normalizeBattlefield(source, false, battleWindow);
  const screenshot = screenshotCanvas.getContext("2d", { willReadFrequently: true });
  const countContext = countCanvas.getContext("2d", { willReadFrequently: true });
  const backgroundId = identifyBackground(screenshotCanvas, data.backgrounds);
  const background = data.backgrounds.find((candidate) => candidate.id === backgroundId);
  const backgroundImage = await loadImage(`./public/${background.image}`);
  const backgroundCanvas = drawToCanvas(backgroundImage, WIDTH, HEIGHT);
  const backgroundContext = backgroundCanvas.getContext("2d", { willReadFrequently: true });
  const terrain = inferTerrain(background);
  const obstacleBackgroundContext = prepareObstacleDetectionBackground(
    screenshot,
    backgroundContext,
    data.battlefield.grid
  );
  const preparedAt = performance.now();

  const [detectedObstacles, turnRoster] = await Promise.all([
    detectObstacles(screenshot, obstacleBackgroundContext, data, terrain),
    turnRosterPromise
  ]);
  const obstaclesAt = performance.now();
  const blocked = new Set(detectedObstacles.flatMap((obstacle) => obstacle.blockedHexIds));
  const stacks = await detectStacks(screenshot, backgroundContext, data, blocked, countContext, turnRoster);
  // Imported units are redeployed to their standard starting positions by
  // the setup flow. Their mid-round screenshot coordinates therefore cannot
  // invalidate a detected obstacle: tall foreground graphics legitimately
  // overlap units and badges in the source image.
  const obstacles = detectedObstacles;
  applyRosterCounts(stacks, turnRoster);
  const rosterCompletedStacks = completeStacksFromTurnRoster(stacks, turnRoster, data);
  assignImportedArmySlots(data.battlefield.grid, stacks);
  const stacksAt = performance.now();
  // Native TextDetector OCR is intentionally not used for Heroes III badges:
  // its general-purpose glyph model confuses the game's tiny bitmap 5/6/1.
  const bitmapCounts = stacks.filter((stack) => stack.screenshotCountRecognized).length;
  const rosterStacks = (turnRoster?.lowerBoundRoster || [])
    .reduce((sum, entry) => sum + Number(entry.instances || 0), 0);
  const rosterNote = rosterStacks
    ? `The native turn bar reconstructed ${rosterStacks} known stacks${rosterCompletedStacks ? `, including ${rosterCompletedStacks} not recoverable from battlefield sprites` : ""}.`
    : "No usable native turn-bar roster was found; battlefield matching used the legacy fallback.";
  const completedAt = performance.now();
  return {
    backgroundId,
    battleWindow,
    obstacles,
    stacks,
    turnRoster,
    obstacleDetectionDiagnostics: detectedObstacles.detectionDiagnostics,
    stackDetectionDiagnostics: stacks.detectionDiagnostics,
    note: bitmapCounts
      ? `${rosterNote} ${bitmapCounts} stack counts were read automatically.`
      : `${rosterNote} Counts that cannot be read confidently remain 1 and can be edited with right-click.`,
    timings: {
      prepareMs: preparedAt - startedAt,
      obstaclesMs: obstaclesAt - preparedAt,
      stacksMs: stacksAt - obstaclesAt,
      ocrMs: completedAt - stacksAt,
      totalMs: completedAt - startedAt
    }
  };
}

export function completeStacksFromTurnRoster(stacks, turnRoster, data) {
  const roster = turnRoster?.lowerBoundRoster || [];
  if (!roster.length) return 0;
  let added = 0;
  const matched = new Set();
  const entries = roster.filter((entry) => (
    ["player", "ai"].includes(entry.owner)
    && integerCreatureId(entry.creatureId) !== null
  ));

  for (const entry of entries) {
    const creatureId = integerCreatureId(entry.creatureId);
    const expectedCount = Math.trunc(Number(entry.count));
    const expectedInstances = Math.max(1, Math.trunc(Number(entry.instances) || 1));
    const sameCreature = stacks.filter((stack) => (
      !matched.has(stack)
      && stack.owner === entry.owner
      && Number(stack.creature?.creatureId) === creatureId
    ));
    const matching = sameCreature.filter((stack) => (
      !Number.isInteger(expectedCount) || expectedCount < 1 || stack.count === expectedCount
    ));
    matching.slice(0, expectedInstances).forEach((stack) => matched.add(stack));
    const visuallyMatched = Math.min(expectedInstances, matching.length);
    const countCorrected = sameCreature
      .filter((stack) => !matched.has(stack))
      .slice(0, expectedInstances - visuallyMatched);
    for (const stack of countCorrected) {
      if (Number.isInteger(expectedCount) && expectedCount > 0) setImportedStackCount(stack, expectedCount);
      matched.add(stack);
    }
    const creature = data.creatures.find((candidate) => Number(candidate.creatureId) === creatureId);
    if (!creature) continue;
    const currentOwnerCount = stacks.filter((stack) => stack.owner === entry.owner).length;
    const consumed = visuallyMatched + countCorrected.length;
    const missing = Math.min(expectedInstances - consumed, 7 - currentOwnerCount);
    const createdAt = stacks.length;
    for (let index = 0; index < missing; index += 1) {
      const count = Number.isInteger(expectedCount) && expectedCount > 0 ? expectedCount : 1;
      const fallbackHex = data.battlefield.grid.hexes.find((hex) => (
        hex.row === 5 && hex.col === (entry.owner === "player" ? 0 : 14)
      )) || data.battlefield.grid.hexes[0];
      const stack = createBattleStack({
        creature,
        owner: entry.owner,
        hexId: fallbackHex.id,
        count,
        armySlot: currentOwnerCount + index,
        createdAt: createdAt + index
      });
      stack.detectionConfidence = 1;
      stack.screenshotCountRecognized = Number.isInteger(expectedCount) && expectedCount > 0;
      stack.screenshotCountFromTurnBar = true;
      stack.screenshotRosterOnly = true;
      stacks.push(stack);
      matched.add(stack);
      added += 1;
    }
  }
  return added;
}

export function applyRosterCounts(stacks, turnRoster) {
  const countSlots = new Map();
  for (const entry of turnRoster?.lowerBoundRoster || []) {
    const key = `${entry.owner}:${entry.creatureId}`;
    const count = Math.trunc(Number(entry.count));
    if (!Number.isInteger(count) || count < 1) continue;
    const slots = countSlots.get(key) || [];
    for (let index = 0; index < Math.max(1, Number(entry.instances) || 1); index += 1) slots.push(count);
    countSlots.set(key, slots);
  }

  for (const [key, availableCounts] of countSlots) {
    const [owner, creatureId] = key.split(":");
    const matchingStacks = stacks.filter((stack) =>
      stack.owner === owner && Number(stack.creature.creatureId) === Number(creatureId)
    );
    const remaining = [...availableCounts];
    const exactMatches = new Set();
    // Exact badge reads establish the mapping when one creature type appears
    // in several differently sized stacks (for example 20 + four split 1s).
    for (const stack of matchingStacks.filter((candidate) => candidate.screenshotCountRecognized)) {
      const exactIndex = remaining.indexOf(stack.count);
      if (exactIndex >= 0) {
        remaining.splice(exactIndex, 1);
        exactMatches.add(stack);
      }
    }
    const unresolved = matchingStacks.filter((stack) => !exactMatches.has(stack));
    if (unresolved.length !== remaining.length) continue;

    // A low-resolution badge can turn 1 into 41. Use its approximate value to
    // consume the nearest remaining roster count; exact reads were protected
    // above. Truly unread badges are filled only when the remainder is
    // unambiguous.
    for (const stack of unresolved.filter((candidate) => candidate.screenshotCountRecognized)) {
      if (!remaining.length) break;
      let nearestIndex = 0;
      for (let index = 1; index < remaining.length; index += 1) {
        if (Math.abs(remaining[index] - stack.count) < Math.abs(remaining[nearestIndex] - stack.count)) nearestIndex = index;
      }
      setImportedStackCount(stack, remaining.splice(nearestIndex, 1)[0]);
      exactMatches.add(stack);
    }
    const unread = unresolved.filter((stack) => !exactMatches.has(stack));
    if (unread.length === remaining.length && (remaining.length === 1 || new Set(remaining).size === 1)) {
      unread.forEach((stack, index) => setImportedStackCount(stack, remaining[index]));
    }
  }
  inferUnreadCountsFromMatchingStacks(stacks);
}

function inferUnreadCountsFromMatchingStacks(stacks) {
  const groups = new Map();
  for (const stack of stacks || []) {
    const key = `${stack.owner}:${stack.creature.creatureId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(stack);
  }
  for (const matchingStacks of groups.values()) {
    const frequencies = new Map();
    for (const stack of matchingStacks.filter((candidate) => candidate.screenshotCountRecognized)) {
      frequencies.set(stack.count, (frequencies.get(stack.count) || 0) + 1);
    }
    const ranked = [...frequencies].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    if (!ranked.length || ranked[0][1] < 2 || ranked[0][1] === ranked[1]?.[1]) continue;
    for (const stack of matchingStacks.filter((candidate) => (
      !candidate.screenshotCountRecognized && !candidate.screenshotCountFromTurnBar
    ))) {
      setImportedStackCount(stack, ranked[0][0]);
      stack.screenshotCountFromTurnBar = false;
      stack.screenshotCountInferredFromPeers = true;
    }
  }
}

function setImportedStackCount(stack, count) {
  stack.count = count;
  stack.initialCount = count;
  stack.hpTotal = count * Math.max(1, Number(stack.creature.stats.hp || 1));
  stack.wound = 0;
  stack.screenshotCountFromTurnBar = true;
}

export function normalizeBattlefield(image, smoothing = true, bounds = null) {
  const imageWidth = image.naturalWidth || image.videoWidth || image.width;
  const imageHeight = image.naturalHeight || image.videoHeight || image.height;
  const targetRatio = WIDTH / HEIGHT;
  const sourceBounds = canonicalBattlefieldContentBounds(
    bounds || { x: 0, y: 0, width: imageWidth, height: imageHeight },
    imageWidth,
    imageHeight
  );
  const sourceRatio = sourceBounds.width / sourceBounds.height;
  let sw = sourceBounds.width;
  let sh = sourceBounds.height;
  // A turn-bar-derived window has an exact inner battlefield rectangle. The
  // aspect fallback remains only for legacy screenshots without that marker.
  if (!sourceBounds.canonical) {
    if (sourceRatio > targetRatio) sw = sourceBounds.height * targetRatio;
    else if (sourceRatio < targetRatio) sh = sourceBounds.width / targetRatio;
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = smoothing;
  context.drawImage(image, sourceBounds.x, sourceBounds.y, sw, sh, 0, 0, WIDTH, HEIGHT);
  return canvas;
}

export function canonicalBattlefieldContentBounds(bounds, sourceWidth, sourceHeight) {
  if (bounds?.method !== "turn-bar") return { ...bounds, canonical: false };
  const scale = Number(bounds.scale) || 1;
  const estimatedX = Number.isFinite(bounds.estimatedX) ? bounds.estimatedX : bounds.x;
  const estimatedY = Number.isFinite(bounds.estimatedY) ? bounds.estimatedY : bounds.y;
  const expected = {
    x: estimatedX + BATTLE_CONTENT_OFFSET_X * scale,
    y: estimatedY + BATTLE_CONTENT_OFFSET_Y * scale,
    width: BATTLE_CONTENT_REFERENCE_WIDTH * scale,
    height: BATTLE_CONTENT_REFERENCE_HEIGHT * scale
  };
  const x = Math.max(0, expected.x);
  const y = Math.max(0, expected.y);
  return {
    x,
    y,
    width: Math.max(1, Math.min(expected.width - (x - expected.x), sourceWidth - x)),
    height: Math.max(1, Math.min(expected.height - (y - expected.y), sourceHeight - y)),
    canonical: true
  };
}

export function identifyBackground(canvas, backgrounds) {
  const { x, y, width, height, sampleWidth, sampleHeight } = BACKGROUND_FINGERPRINT;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  sampleCanvas.getContext("2d").drawImage(canvas, x, y, width, height, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleCanvas.getContext("2d").getImageData(0, 0, sampleWidth, sampleHeight).data;
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = 16;
  fullCanvas.height = 11;
  fullCanvas.getContext("2d").drawImage(canvas, 0, 0, 16, 11);
  const fullPixels = fullCanvas.getContext("2d").getImageData(0, 0, 16, 11).data;
  const horizonScores = [];
  for (const background of backgrounds) {
    const fingerprint = background.horizonFingerprint;
    if (!fingerprint?.length) continue;
    const pixelErrors = [];
    for (let index = 0, pixel = 0; index < fingerprint.length; index += 3, pixel += 4) {
      pixelErrors.push((
        Math.abs(fingerprint[index] - pixels[pixel])
        + Math.abs(fingerprint[index + 1] - pixels[pixel + 1])
        + Math.abs(fingerprint[index + 2] - pixels[pixel + 2])
      ) / 3);
    }
    // Heroes and selection glows can enter the skyline. A trimmed score keeps
    // those local outliers from turning desert into dirt or grass into rough.
    pixelErrors.sort((left, right) => left - right);
    const inlierCount = Math.max(1, Math.floor(pixelErrors.length * 0.8));
    const horizonError = pixelErrors.slice(0, inlierCount).reduce((sum, value) => sum + value, 0) / inlierCount;
    horizonScores.push({ background, horizonError });
  }
  horizonScores.sort((left, right) => left.horizonError - right.horizonError);
  if (horizonScores.length) {
    const closeCandidates = horizonScores.filter((candidate) => (
      candidate.horizonError <= horizonScores[0].horizonError + 0.5
    ));
    if (closeCandidates.length > 1) {
      // Some special fields intentionally reuse another battlefield's entire
      // skyline. Compare only full-frame cells where those near-tied catalog
      // candidates materially differ; common grass and screenshot occlusion
      // cannot drown the actual overlay signal that way.
      const discriminativeIndexes = [];
      const fingerprintLength = Math.min(...closeCandidates.map(({ background }) => (
        background.fingerprint?.length || 0
      )));
      for (let index = 0; index < fingerprintLength; index += 3) {
        let maximumPairDelta = 0;
        for (let left = 0; left < closeCandidates.length; left += 1) {
          for (let right = left + 1; right < closeCandidates.length; right += 1) {
            const leftFingerprint = closeCandidates[left].background.fingerprint;
            const rightFingerprint = closeCandidates[right].background.fingerprint;
            const delta = (
              Math.abs(leftFingerprint[index] - rightFingerprint[index])
              + Math.abs(leftFingerprint[index + 1] - rightFingerprint[index + 1])
              + Math.abs(leftFingerprint[index + 2] - rightFingerprint[index + 2])
            ) / 3;
            maximumPairDelta = Math.max(maximumPairDelta, delta);
          }
        }
        if (maximumPairDelta >= 10) discriminativeIndexes.push(index);
      }
      if (discriminativeIndexes.length) {
        for (const candidate of closeCandidates) {
          candidate.discriminatorError = discriminativeIndexes.reduce((sum, index) => {
            const pixel = index / 3 * 4;
            const fingerprint = candidate.background.fingerprint;
            return sum + (
              Math.abs(fingerprint[index] - fullPixels[pixel])
              + Math.abs(fingerprint[index + 1] - fullPixels[pixel + 1])
              + Math.abs(fingerprint[index + 2] - fullPixels[pixel + 2])
            ) / 3;
          }, 0) / discriminativeIndexes.length;
        }
        closeCandidates.sort((left, right) => (
          left.discriminatorError - right.discriminatorError
          || left.horizonError - right.horizonError
        ));
      }
    }
    return closeCandidates[0].background.id;
  }

  // Backwards-compatible fallback for an older generated catalog.
  let best = null;
  for (const background of backgrounds) {
    let error = 0;
    for (let index = 0, pixel = 0; index < background.fingerprint.length; index += 3, pixel += 4) {
      error += Math.abs(background.fingerprint[index] - fullPixels[pixel]);
      error += Math.abs(background.fingerprint[index + 1] - fullPixels[pixel + 1]);
      error += Math.abs(background.fingerprint[index + 2] - fullPixels[pixel + 2]);
    }
    if (!best || error < best.error) best = { id: background.id, error };
  }
  return best?.id || "cmbkgrtr";
}

function prepareObstacleDetectionBackground(screenshotContext, backgroundContext, grid) {
  const screenshot = contextPixels(screenshotContext);
  const cleanBackground = contextPixels(backgroundContext);
  const canvas = drawToCanvas(backgroundContext.canvas, WIDTH, HEIGHT);
  const adjustedContext = canvas.getContext("2d", { willReadFrequently: true });
  const adjustedImage = adjustedContext.getImageData(0, 0, WIDTH, HEIGHT);
  let adjustedHexes = 0;

  for (const hex of grid.hexes) {
    const points = hex.polygonPoints || [];
    if (points.length < 3) continue;
    const minX = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x))) + 3);
    const maxX = Math.min(WIDTH - 1, Math.ceil(Math.max(...points.map(([x]) => x))) - 3);
    const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))) + 3);
    const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(...points.map(([, y]) => y))) - 3);
    const channelRatios = [[], [], []];
    // The native game paints movement/reachability as a dark translucent fill
    // over complete hexes. Sample the full inset hex instead of only its
    // centre: tall cacti and two-hex creatures can cover that centre while
    // enough ground remains visible around their silhouette.
    for (let y = minY; y <= maxY; y += 3) {
      for (let x = minX; x <= maxX; x += 3) {
        if (!pointInPolygon(x + 0.5, y + 0.5, points)) continue;
        const index = (y * WIDTH + x) * 4;
        const baseTotal = cleanBackground[index] + cleanBackground[index + 1] + cleanBackground[index + 2];
        const screenTotal = screenshot[index] + screenshot[index + 1] + screenshot[index + 2];
        if (baseTotal < 90 || screenTotal < 30) continue;
        const chromaDistance = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(
          screenshot[index + channel] / screenTotal - cleanBackground[index + channel] / baseTotal
        ), 0);
        if (chromaDistance > 0.16) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          const base = cleanBackground[index + channel];
          if (base < 20) continue;
          channelRatios[channel].push(screenshot[index + channel] / base);
        }
      }
    }

    if (channelRatios.some((ratios) => ratios.length < 12)) continue;
    const ratios = channelRatios.map(median).map((ratio) => Math.max(0.2, Math.min(1, ratio)));
    // Leave ordinary battlefield pixels untouched. The threshold is well
    // above the roughly half-bright native reachability overlay, yet below
    // normal capture/compression variation.
    if (ratios.reduce((sum, ratio) => sum + ratio, 0) / 3 > 0.78) continue;
    adjustedHexes += 1;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!pointInPolygon(x + 0.5, y + 0.5, points)) continue;
        const index = (y * WIDTH + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          adjustedImage.data[index + channel] = Math.round(cleanBackground[index + channel] * ratios[channel]);
        }
      }
    }
  }

  if (!adjustedHexes) {
    backgroundContext.cleanCompositeBackground = backgroundContext;
    return backgroundContext;
  }
  adjustedContext.putImageData(adjustedImage, 0, 0);
  // Reachability shading is painted after battlefield obstacles in the native
  // renderer. Keep the clean terrain alongside the shade-matched background
  // so template compositing can apply the same shade to opaque sprite pixels,
  // instead of incorrectly treating the shaded terrain as a layer below them.
  adjustedContext.cleanCompositeBackground = backgroundContext;
  return adjustedContext;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function detectObstacles(screenshot, background, data, terrain) {
  const definitions = data.obstacles.filter((obstacle) =>
    obstacle.allowedTerrains.includes(terrain) || obstacle.specialBattlefields.includes(terrain) || obstacle.category === terrain
  );
  const images = new Map(await Promise.all(definitions.map(async (definition) => [
    definition.id,
    await loadImage(`./public/${definition.image}`)
  ])));
  const candidates = [];
  const detectionDiagnostics = [];

  for (const definition of definitions.filter((candidate) => candidate.absolute)) {
    const image = images.get(definition.id);
    const originX = Number.isFinite(definition.placementOffsetX) ? definition.placementOffsetX : definition.width;
    const originY = Number.isFinite(definition.placementOffsetY) ? definition.placementOffsetY : definition.height;
    const placement = bestCompositePlacement(screenshot, background, image, originX, originY, {
      radiusX: 5, radiusY: 5, step: 1, allowFlip: false, sampleStep: 3,
      ignoreForegroundOcclusion: true, rankByObstacleQuality: true
    });
    placement.anchorDistance = Math.hypot(placement.x - originX, placement.y - originY);
    detectionDiagnostics.push({ definitionId: definition.id, anchorHexId: null, ...placement });
    if (placement.correlation > 0.45 && placement.gain > 0.08 && placement.match > 0.82) {
      candidates.push({ definition, anchorHexId: null, ...placement });
    }
  }

  for (const definition of definitions.filter((candidate) => !candidate.absolute)) {
    const image = images.get(definition.id);
    const alphaDensity = templateAlphaDensity(image);
    const sparseTemplate = alphaDensity < 0.3;
    const thinSingleCellTemplate = definition.blockedTiles.length === 1 && alphaDensity < 0.34;
    const smallTemplate = image.width * image.height < 3000;
    const coarseCandidates = [];
    for (const anchor of data.battlefield.grid.hexes) {
      if (!canPlaceObstacle(data.battlefield.grid, { stacks: [], obstacles: [] }, definition, anchor.id)) continue;
      const blockedHexIds = obstacleBlockedHexes(data.battlefield.grid, definition, anchor.id);
      if (blockedHexIds.length !== definition.blockedTiles.length) continue;
      const expectedPosition = obstacleNativePosition(data.battlefield.grid, { ...definition, anchorHexId: anchor.id });
      if (!expectedPosition) continue;
      const placement = bestCompositePlacement(screenshot, background, image, expectedPosition.left, expectedPosition.top, {
        // Every candidate is first scored at its legal native origin. A free
        // half-hex search can match a real sprite while retaining the logical
        // anchor of a neighbouring row, which was the source of the Wasteland
        // one-hex displacement.
        radiusX: 0,
        radiusY: 0,
        step: 1,
        allowFlip: false,
        ignoreForegroundOcclusion: true,
        rankByObstacleQuality: true,
        sampleStep: smallTemplate || sparseTemplate ? 2 : 4
      });
      coarseCandidates.push({
        anchor,
        blockedHexIds,
        expectedLeft: expectedPosition.left,
        expectedTop: expectedPosition.top,
        ...placement
      });
    }
    coarseCandidates.sort((left, right) => obstacleMatchQuality(right) - obstacleMatchQuality(left));
    const shortlist = coarseCandidates.slice(0, sparseTemplate || smallTemplate ? 18 : 10);
    let diagnosticBest = null;
    for (const coarse of shortlist) {
      const placement = bestCompositePlacement(screenshot, background, image, coarse.expectedLeft, coarse.expectedTop, {
        // Only sub-pixel crop/rasterisation drift is refined. The winning
        // logical anchor remains the one whose native origin is being tested.
        radiusX: 5,
        radiusY: 5,
        step: 1,
        fixedFlip: false,
        sampleStep: sparseTemplate || smallTemplate ? 2 : 3,
        ignoreForegroundOcclusion: true,
        rankByObstacleQuality: true
      });
      placement.anchorDistance = Math.hypot(
        placement.x - coarse.expectedLeft,
        placement.y - coarse.expectedTop
      );
      const closeToNativeAnchor = placement.anchorDistance <= 7.2;
      const normalMatch = closeToNativeAnchor
        && placement.correlation > 0.5 && placement.gain > 0.3 && placement.match > 0.72;
      // A tall creature can hide most of an obstacle while leaving a very
      // characteristic fragment visible. In that case the obstacle still
      // has excellent correlation/chroma, but its improvement over the
      // background is necessarily smaller. Accept only this much stricter
      // high-similarity signature so occluded rocks are preserved without
      // admitting generic battlefield noise.
      const strongOccludedMatch = closeToNativeAnchor
        && placement.correlation > 0.72
        && placement.gain > 0.12
        && placement.match > 0.84
        && placement.chroma > 0.985;
      // Thin cacti can cover only a small fraction of a dark movement-shaded
      // hex. Their clean native color signature remains reliable even when
      // replacing the adjusted terrain does not improve the aggregate error.
      const sparseNativeColorMatch = closeToNativeAnchor
        && thinSingleCellTemplate
        && placement.correlation > 0.48
        && placement.gain > -0.08
        && placement.match > 0.87
        && placement.chroma > 0.982;
      // Tiny translucent field markers can be closer in raw RGB error to a
      // similarly coloured special-field background than to their unshaded
      // source PNG. Their shape/chroma correlation remains distinctive, so
      // admit only this strict small-overlay signature when ordinary gain is
      // unavailable.
      const distinctSmallOverlayMatch = closeToNativeAnchor
        && smallTemplate
        && placement.gain <= 0.3
        && placement.correlation > 0.84
        && placement.match > 0.86
        && placement.chroma > 0.96;
      const diagnostic = { definitionId: definition.id, anchorHexId: coarse.anchor.id, ...placement };
      if (!diagnosticBest
        || anchoredObstacleMatchQuality(diagnostic) > anchoredObstacleMatchQuality(diagnosticBest)) diagnosticBest = diagnostic;
      const matchMode = normalMatch
        ? "normal"
        : strongOccludedMatch
          ? "occluded"
          : sparseNativeColorMatch
            ? "sparse"
            : distinctSmallOverlayMatch
              ? "overlay"
              : null;
      if (matchMode) {
        candidates.push({
          definition,
          anchorHexId: coarse.anchor.id,
          blockedHexIds: coarse.blockedHexIds,
          matchMode,
          ...placement
        });
      }
    }
    if (diagnosticBest) detectionDiagnostics.push(diagnosticBest);
  }

  candidates.sort((left, right) => (
    (right.definition.absolute - left.definition.absolute)
    || (anchoredObstacleMatchQuality(right) - anchoredObstacleMatchQuality(left))
  ));
  const accepted = [];
  for (const candidate of candidates) {
    const anchorHexId = candidate.anchorHexId;
    const blockedHexIds = candidate.definition.absolute
      ? (candidate.blockedHexIds || obstacleBlockedHexes(data.battlefield.grid, candidate.definition, anchorHexId))
      : detectedObstacleBlockedHexes(data.battlefield.grid, candidate.definition, anchorHexId);
    if (accepted.some((item) => (
      (!item.absolute && !candidate.definition.absolute && item.anchorHexId === candidate.anchorHexId)
      || (
        Math.abs(item.detectedLeft - candidate.x) <= 8
        && Math.abs(item.detectedTop - candidate.y) <= 8
      )
      || (() => {
        const overlap = blockedHexIds.filter((hexId) => item.blockedHexIds?.includes(hexId)).length;
        // A single native obstacle cannot occupy the same battlefield cells
        // twice. Wide/tall sprites otherwise make their smaller catalog
        // siblings look like additional obstacles at neighbouring anchors.
        // Keep partially-overlapping adjacent HotA graphics (some catalog
        // footprints share an edge cell), but suppress candidates whose own
        // footprint is almost entirely explained by a stronger match.
        if (!overlap) return false;
        if (item.id === candidate.definition.id) return true;
        // Broad native sprites are often assembled from smaller catalog art,
        // so those component templates can also score at neighbouring
        // anchors. Suppress a component only when a stronger candidate
        // already explains at least 75% of its logical footprint. Sparse
        // color-only and translucent-overlay matches are exempt: HotA scenes
        // can contain those real graphics even when catalog footprints share
        // an edge cell (notably narrow Wasteland cacti).
        return ["normal", "occluded"].includes(candidate.matchMode)
          && overlap / Math.max(1, blockedHexIds.length) >= 0.75;
      })()
      || templateEmbeddingRatio(
        obstacleTemplateRecord(images.get(candidate.definition.id), candidate.x, candidate.y, candidate.flip),
        obstacleTemplateRecord(images.get(item.id), item.detectedLeft, item.detectedTop, item.detectedFlip)
      ) >= 0.25
    ))) continue;
    // Visual evidence is authoritative during import. HotA scenes can contain
    // adjacent graphics whose catalog footprints share an edge cell; dropping
    // the second strong template makes a visible obstacle disappear. The
    // simulator safely stores the union of blocked cells.
    if (candidate.definition.absolute && accepted.some((item) => item.absolute)) continue;
    const instance = createObstacleInstance(data.battlefield.grid, candidate.definition, anchorHexId);
    instance.detectionConfidence = candidate.gain;
    instance.detectedFlip = candidate.flip;
    instance.detectedLeft = candidate.x;
    instance.detectedTop = candidate.y;
    instance.blockedHexIds = blockedHexIds;
    accepted.push(instance);
    if (accepted.length >= 12) break;
  }
  accepted.detectionDiagnostics = detectionDiagnostics;
  return accepted;
}

async function detectStacks(screenshot, background, data, blocked, countContext = screenshot, roster = null) {
  const templateRecords = data.creatures.flatMap((creature) =>
    (data.creatureDetection?.creatures?.[String(creature.creatureId)]?.frames || [])
      .map((record) => ({ creature, record }))
  );
  const templates = await Promise.all(templateRecords.map(async ({ creature, record }) => ({
    creature,
    record,
    image: await loadImage(`./public/${record.image}`)
  })));
  const templatesByCreature = new Map();
  for (const template of templates) {
    const creatureId = template.creature.creatureId;
    if (!templatesByCreature.has(creatureId)) templatesByCreature.set(creatureId, []);
    templatesByCreature.get(creatureId).push(template);
  }
  const rosterCapacityMap = rosterCapacities(roster);
  const hasRosterPrior = rosterCapacityMap.size > 0;

  const candidateGroups = [];
  const badges = detectStackBadges(screenshot);
  const digitTemplates = await loadDigitTemplates(data);
  for (const badge of badges) {
    const smoothCount = readBadgeCount(screenshot, badge, digitTemplates);
    const sharpCount = readBadgeCount(countContext, badge, digitTemplates);
    const selectedCount = selectBadgeCount(smoothCount, sharpCount);
    badge.count = selectedCount?.value || null;
    badge.countDiagnostics = { smooth: smoothCount, sharp: sharpCount, selected: selectedCount };
  }
  for (const badge of badges) {
    const badgePlacements = ["player", "ai"]
      .map((owner) => locateBadgeOnGrid(badge, data.battlefield.grid, owner))
      .filter(Boolean);
    if (!badgePlacements.length) continue;
    let best = null;
    const bestByCreature = new Map();
    const coarseCandidates = [];
    for (const badgePlacement of badgePlacements) {
      for (const creatureTemplates of templatesByCreature.values()) {
        let coarseBest = null;
        for (const template of representativeTemplates(creatureTemplates)) {
          for (const scale of creatureTemplateScales(template)) {
            const candidate = scoreCreatureTemplate(
              screenshot,
              background,
              data.battlefield.grid,
              blocked,
              badgePlacement,
              scaledCreatureTemplate(template, scale),
              true
            );
            if (candidate && (!coarseBest || candidate.quality > coarseBest.quality)) coarseBest = candidate;
          }
        }
        if (coarseBest) coarseCandidates.push(coarseBest);
      }
    }
    coarseCandidates.sort((left, right) => right.quality - left.quality);
    const coarseFloor = (coarseCandidates[0]?.quality ?? 0) - 0.08;
    const legacyShortlist = coarseCandidates.filter((candidate, index) => index < 6 || (index < 10 && candidate.quality >= coarseFloor));
    // The native queue is only a lower bound: the visible strip can be clipped
    // and conservative recognition intentionally leaves uncertain cards
    // unknown. Always keep the normal visual shortlist, while guaranteeing
    // that every known roster creature also reaches the detailed scorer.
    const rosterShortlist = hasRosterPrior
      ? coarseCandidates.filter((candidate) => rosterCapacityMap.has(`${candidate.owner}:${candidate.creature.creatureId}`))
      : [];
    const shortlist = [...new Set([...rosterShortlist, ...legacyShortlist])];
    for (const coarseCandidate of shortlist) {
      const creatureTemplates = templatesByCreature.get(coarseCandidate.creature.creatureId) || [];
      for (const template of creatureTemplates) {
        const candidate = scoreCreatureTemplate(
          screenshot,
          background,
          data.battlefield.grid,
          blocked,
          coarseCandidate,
          scaledCreatureTemplate(template, coarseCandidate.templateScale || 1),
          false
        );
        if (!candidate) continue;
        const key = `${candidate.owner}:${candidate.creature.creatureId}`;
        const previous = bestByCreature.get(key);
        if (!previous || candidate.quality > previous.quality) bestByCreature.set(key, candidate);
        if (!best || candidate.quality > best.quality) best = candidate;
      }
    }
    const rankedCandidates = [...bestByCreature.values()]
      .sort((left, right) => right.quality - left.quality);
    const alternatives = rankedCandidates
      .slice(0, 5)
      .map(({ creature, owner, quality, rawQuality, sidePenalty, correlation, chroma, gain, match }) => ({
        creatureId: creature.creatureId, name: creature.name, owner, quality, rawQuality, sidePenalty, correlation, chroma, gain, match
    }));
    if (best) best.detectionAlternatives = alternatives;
    if (best) {
      candidateGroups.push({
        badge,
        best: { ...best, badge },
        alternatives: rankedCandidates.map((candidate) => ({ ...candidate, badge }))
      });
    }
  }

  // Known roster entries compete globally for their lower-bound
  // multiplicities. Unassigned badges retain the strict legacy visual
  // fallback, so a clipped or unrecognized queue card cannot delete a real
  // battlefield stack.
  const completeRosterOwners = completeTurnRosterOwners(roster);
  const rosterAssignment = assignStackCandidatesToRoster(candidateGroups, roster, {
    minimumQuality: -0.15,
    // Seven recognized stacks make that side of the queue an exact army
    // inventory, even when the other side has already acted and is only a
    // partial lower bound. An idle, turn or underground animation frame may
    // then look materially different from the extracted DEF reference: the
    // global assignment must still consume every proven identity on that
    // complete side. Partial sides keep the conservative visual guard, so one
    // visible card cannot turn a strong Pikeman into a Halberdier.
    maxVisualQualityDrop: ROSTER_VISUAL_QUALITY_TOLERANCE,
    allowMaterialVisualDrop: (candidate) => completeRosterOwners.has(candidate.owner)
  });
  const candidates = mergeRosterAssignmentsWithFallback(candidateGroups, rosterAssignment, roster);
  const accepted = [];
  const usedHexes = new Set();
  const ownerCounts = { player: 0, ai: 0 };
  for (const candidate of candidates) {
    if (usedHexes.has(candidate.primaryHex.id)) continue;
    const owner = candidate.owner;
    if (ownerCounts[owner] >= 7) continue;
    const stack = createBattleStack({
      creature: candidate.creature,
      owner,
      hexId: candidate.primaryHex.id,
      count: candidate.badge.count || 1,
      armySlot: null,
      createdAt: accepted.length
    });
    const footprint = footprintHexes(data.battlefield.grid, stack) || [candidate.primaryHex.id];
    // A mid-battle screenshot is authoritative: Heroes III can draw a tall
    // foreground obstacle over a living stack and its badge. Rejecting that
    // stack because the catalog footprint says "blocked" loses real units.
    // Stack-to-stack overlap is still forbidden.
    if (footprint.some((hexId) => usedHexes.has(hexId))) continue;
    ownerCounts[owner] += 1;
    stack.detectionConfidence = candidate.quality;
    stack.detectionAlternatives = candidate.detectionAlternatives;
    stack.screenshotBadgeBounds = {
      minX: candidate.badge.minX,
      minY: candidate.badge.minY,
      width: candidate.badge.width,
      height: candidate.badge.height
    };
    stack.screenshotCountDiagnostics = candidate.badge.countDiagnostics;
    stack.screenshotCountRecognized = Boolean(candidate.badge.count);
    stack.screenshotSourceHexId = candidate.primaryHex.id;
    stack.screenshotSourceRow = candidate.primaryHex.row;
    accepted.push(stack);
    for (const occupiedHexId of footprint) usedHexes.add(occupiedHexId);
  }
  // A badge may be completely hidden by a tall overlapping creature or
  // foreground obstacle. The turn bar tells us that the stack exists, but it
  // cannot tell us the army slot because cards are ordered by initiative.
  // Recover such stacks by scanning their known sprite identities over legal
  // battlefield anchors before falling back to a roster-only placeholder.
  const recovered = recoverUnbadgedRosterStacks(
    screenshot,
    background,
    data,
    blocked,
    roster,
    templatesByCreature,
    accepted,
    usedHexes
  );
  for (const stack of recovered) {
    if (ownerCounts[stack.owner] >= 7) continue;
    ownerCounts[stack.owner] += 1;
    accepted.push(stack);
    for (const occupiedHexId of footprintHexes(data.battlefield.grid, stack) || [stack.hexId]) usedHexes.add(occupiedHexId);
  }
  accepted.detectionDiagnostics = {
    badgeCount: badges.length,
    candidateGroupCount: candidateGroups.length,
    rosterAssignments: (rosterAssignment || []).map((candidate) => ({
      badgeY: candidate.badge?.minY,
      owner: candidate.owner,
      creatureId: candidate.creature?.creatureId,
      name: candidate.creature?.name,
      quality: candidate.quality
    })),
    mergedCandidates: candidates.map((candidate) => ({
      badgeY: candidate.badge?.minY,
      owner: candidate.owner,
      creatureId: candidate.creature?.creatureId,
      name: candidate.creature?.name,
      quality: candidate.quality,
      primaryHexId: candidate.primaryHex?.id
    })),
    groups: candidateGroups.map((group) => ({
      badge: {
        minX: group.badge.minX,
        minY: group.badge.minY,
        count: group.badge.count
      },
        alternatives: group.alternatives.slice(0, 8).map((candidate) => ({
          owner: candidate.owner,
          creatureId: candidate.creature.creatureId,
          name: candidate.creature.name,
          quality: candidate.quality,
          rawQuality: candidate.rawQuality,
          correlation: candidate.correlation,
          chroma: candidate.chroma,
          gain: candidate.gain,
          match: candidate.match,
          primaryHexId: candidate.primaryHex.id
        }))
    }))
  };
  return accepted;
}

function recoverUnbadgedRosterStacks(screen, background, data, blocked, roster, templatesByCreature, accepted, usedHexes) {
  const missing = missingRosterStackSpecs(roster, accepted);
  const recovered = [];
  const pending = [...missing];

  // Resolve the strongest visual match globally on every pass. This avoids
  // letting turn-bar card order decide which hidden stack receives the first
  // available spatial position.
  while (pending.length) {
    const proposals = pending.map((spec, index) => ({
      index,
      spec,
      placement: bestUnbadgedRosterPlacement(
        screen,
        background,
        data.battlefield.grid,
        blocked,
        usedHexes,
        spec,
        templatesByCreature.get(spec.creatureId) || []
      )
    })).filter((proposal) => proposal.placement);
    proposals.sort((left, right) => right.placement.quality - left.placement.quality);
    const proposal = proposals[0];
    if (!proposal) break;

    const creature = data.creatures.find((candidate) => Number(candidate.creatureId) === proposal.spec.creatureId);
    if (!creature) {
      pending.splice(proposal.index, 1);
      continue;
    }
    const stack = createBattleStack({
      creature,
      owner: proposal.spec.owner,
      hexId: proposal.placement.primaryHex.id,
      count: proposal.spec.count || 1,
      armySlot: null,
      createdAt: accepted.length + recovered.length
    });
    stack.detectionConfidence = proposal.placement.quality;
    stack.screenshotCountRecognized = Number.isInteger(proposal.spec.count) && proposal.spec.count > 0;
    stack.screenshotCountFromTurnBar = stack.screenshotCountRecognized;
    stack.screenshotRecoveredWithoutBadge = true;
    stack.screenshotSourceHexId = proposal.placement.primaryHex.id;
    stack.screenshotSourceRow = proposal.placement.primaryHex.row;
    stack.detectionAlternatives = [{
      creatureId: creature.creatureId,
      name: creature.name,
      owner: stack.owner,
      quality: proposal.placement.quality,
      rawQuality: proposal.placement.rawQuality,
      correlation: proposal.placement.correlation,
      chroma: proposal.placement.chroma,
      gain: proposal.placement.gain,
      match: proposal.placement.match
    }];
    recovered.push(stack);
    for (const occupiedHexId of footprintHexes(data.battlefield.grid, stack) || [stack.hexId]) usedHexes.add(occupiedHexId);
    pending.splice(proposal.index, 1);
  }
  return recovered;
}

function missingRosterStackSpecs(roster, stacks) {
  const entries = Array.isArray(roster?.lowerBoundRoster) ? roster.lowerBoundRoster : [];
  const remaining = new Map();
  for (const entry of entries) {
    const owner = String(entry?.owner || "").toLowerCase();
    const creatureId = integerCreatureId(entry?.creatureId);
    if (!["player", "ai"].includes(owner) || creatureId === null) continue;
    const key = `${owner}:${creatureId}`;
    const list = remaining.get(key) || [];
    for (let index = 0; index < Math.max(1, Math.trunc(Number(entry.instances) || 1)); index += 1) {
      list.push({
        owner,
        creatureId,
        count: Number.isInteger(Math.trunc(Number(entry.count))) && Number(entry.count) > 0
          ? Math.trunc(Number(entry.count))
          : null
      });
    }
    remaining.set(key, list);
  }
  for (const stack of stacks || []) {
    const key = `${stack.owner}:${Number(stack.creature?.creatureId)}`;
    const list = remaining.get(key);
    if (!list?.length) continue;
    const exactIndex = list.findIndex((spec) => !spec.count || spec.count === stack.count);
    list.splice(exactIndex >= 0 ? exactIndex : 0, 1);
  }
  return [...remaining.values()].flat();
}

function bestUnbadgedRosterPlacement(screen, background, grid, blocked, usedHexes, spec, templates) {
  if (!templates.length) return null;
  const creature = templates[0].creature;
  const coarse = [];
  const representative = representativeTemplates(templates).slice(0, 4);
  for (const primaryHex of grid.hexes) {
    // Mid-round movement may cross the center line, but scanning the distant
    // third of the opponent's side adds many high-color false matches. Keep a
    // generous two-thirds search region for each owner.
    if (spec.owner === "player" && primaryHex.col > 10) continue;
    if (spec.owner === "ai" && primaryHex.col < 4) continue;
    const stackLike = { creature, owner: spec.owner, hexId: primaryHex.id };
    const occupied = footprintHexes(grid, stackLike);
    if (!occupied?.length || occupied.some((hexId) => usedHexes.has(hexId))) continue;
    const placement = { owner: spec.owner, primaryHex, badgeAnchorHex: primaryHex, dx: 0, dy: 0 };
    let best = null;
    for (const template of representative) {
      for (const scale of creatureTemplateScales(template)) {
        const candidate = scoreCreatureTemplate(
          screen,
          background,
          grid,
          blocked,
          placement,
          scaledCreatureTemplate(template, scale),
          true
        );
        if (candidate && (!best || candidate.quality > best.quality)) best = candidate;
      }
    }
    if (best) coarse.push(best);
  }
  coarse.sort((left, right) => right.quality - left.quality);
  let best = null;
  for (const candidate of coarse.slice(0, 8)) {
    const placement = {
      owner: spec.owner,
      primaryHex: candidate.primaryHex,
      badgeAnchorHex: candidate.primaryHex,
      creature: candidate.creature,
      alignmentDx: candidate.alignmentDx,
      alignmentDy: candidate.alignmentDy,
      dx: 0,
      dy: 0
    };
    for (const template of templates) {
      const refined = scoreCreatureTemplate(
        screen,
        background,
        grid,
        blocked,
        placement,
        scaledCreatureTemplate(template, candidate.templateScale || 1),
        false
      );
      if (refined && (!best || refined.quality > best.quality)) best = refined;
    }
  }
  // This pass has no badge to protect it from colorful terrain fragments, so
  // require a strong full-sprite signature. Uncertain stacks remain roster
  // placeholders and are never silently assigned a fabricated source row.
  return best
    && best.quality >= 0.52
    && best.correlation > 0.13
    && best.chroma > 0.82
    && best.match > 0.72
    ? best
    : null;
}

/**
 * Selects at most one alternative from each detected badge while respecting
 * a roster multiset. This is a small capacity-constrained dynamic program,
 * not a greedy pass: the best result is chosen across all badges together.
 *
 * Supported roster forms include turnBarAnalyzer's
 * `{ lowerBoundRoster: [...] }`, a flat array of
 * `{ owner, creatureId, instances }`, and `{ player: [...], ai: [...] }`.
 * `count` is intentionally not treated as multiplicity because it is the
 * number of creatures inside a stack; `instances` is the stack multiplicity.
 * Returns `null` when there is no usable roster so callers can retain their
 * existing fallback unchanged.
 */
export function assignStackCandidatesToRoster(candidateGroups, roster, options = {}) {
  const capacities = rosterCapacities(roster);
  if (!capacities.size) return null;
  const countHints = rosterCountHints(roster);
  const countIdentityHints = turnBarExactCountIdentityHints(roster);

  const capacityKeys = [...capacities.keys()].sort();
  const capacityValues = capacityKeys.map((key) => capacities.get(key));
  const capacityIndex = new Map(capacityKeys.map((key, index) => [key, index]));
  const minimumQuality = Number.isFinite(options.minimumQuality) ? options.minimumQuality : -Infinity;
  const maxVisualQualityDrop = Number.isFinite(options.maxVisualQualityDrop)
    ? Math.max(0, options.maxVisualQualityDrop)
    : Infinity;
  const assignmentBonus = Number.isFinite(options.assignmentBonus) ? options.assignmentBonus : 0;
  const candidateFilter = typeof options.candidateFilter === "function" ? options.candidateFilter : () => true;
  const allowMaterialVisualDrop = typeof options.allowMaterialVisualDrop === "function"
    ? options.allowMaterialVisualDrop
    : () => false;
  const groups = (candidateGroups || []).map((group, groupIndex) => {
    const alternatives = Array.isArray(group?.alternatives) ? group.alternatives : [];
    const bestVisualQuality = alternatives.reduce((best, candidate) => (
      Math.max(best, candidateQuality(candidate))
    ), -Infinity);
    const bestByCapacity = new Map();
    for (const candidate of alternatives) {
      const creatureId = Number(candidate?.creature?.creatureId ?? candidate?.creatureId);
      const owner = candidate?.owner;
      const key = `${owner}:${creatureId}`;
      const index = capacityIndex.get(key);
      const quality = candidateQuality(candidate) + rosterCountEvidence(candidate, countHints.get(key));
      const observedCount = Math.trunc(Number(group?.badge?.count));
      const exactCountIdentity = Number.isInteger(observedCount)
        && countIdentityHints.get(`${owner}:${observedCount}`) === creatureId;
      const excessiveVisualDrop = Number.isFinite(bestVisualQuality)
        && candidateQuality(candidate) < bestVisualQuality - maxVisualQualityDrop;
      if (
        index === undefined
        || !Number.isFinite(quality)
        || quality < minimumQuality
        || (excessiveVisualDrop && !exactCountIdentity && !allowMaterialVisualDrop(candidate))
        || !candidateFilter(candidate)
      ) continue;
      const previous = bestByCapacity.get(index);
      if (!previous || quality > previous.quality) bestByCapacity.set(index, { candidate, quality });
    }
    return {
      groupIndex,
      alternatives: [...bestByCapacity.entries()].map(([capacity, value]) => ({ capacity, ...value }))
    };
  });

  const initialUsage = new Array(capacityKeys.length).fill(0);
  let states = new Map([[usageKey(initialUsage), { usage: initialUsage, score: 0, assignments: [] }]]);
  for (const group of groups) {
    const nextStates = new Map(states);
    for (const state of states.values()) {
      for (const alternative of group.alternatives) {
        if (state.usage[alternative.capacity] >= capacityValues[alternative.capacity]) continue;
        const usage = [...state.usage];
        usage[alternative.capacity] += 1;
        const next = {
          usage,
          score: state.score + alternative.quality + assignmentBonus,
          assignments: [...state.assignments, { groupIndex: group.groupIndex, candidate: alternative.candidate }]
        };
        const key = usageKey(usage);
        const previous = nextStates.get(key);
        if (isBetterAssignment(next, previous)) nextStates.set(key, next);
      }
    }
    states = nextStates;
  }

  let best = null;
  for (const state of states.values()) {
    if (isBetterAssignment(state, best)) best = state;
  }
  return (best?.assignments || [])
    .sort((left, right) => left.groupIndex - right.groupIndex)
    .map((assignment) => assignment.candidate);
}

export function hasCompleteTurnRoster(roster) {
  const completeOwners = completeTurnRosterOwners(roster);
  return completeOwners.has("player") && completeOwners.has("ai");
}

export function completeTurnRosterOwners(roster) {
  const entries = Array.isArray(roster?.lowerBoundRoster) ? roster.lowerBoundRoster : [];
  const instances = { player: 0, ai: 0 };
  for (const entry of entries) {
    const owner = String(entry?.owner || "").toLowerCase();
    const creatureId = integerCreatureId(entry?.creatureId);
    const multiplicity = Math.max(0, Math.trunc(Number(entry?.instances) || 0));
    if (!["player", "ai"].includes(owner) || creatureId === null || !multiplicity) continue;
    instances[owner] += multiplicity;
  }
  // Heroes III armies have at most seven stacks. Reaching that cap on both
  // sides means the recognized queue is no longer merely a lower bound.
  return new Set(["player", "ai"].filter((owner) => instances[owner] === 7));
}

export function mergeRosterAssignmentsWithFallback(candidateGroups, rosterAssignment, roster = null) {
  const assignedBadges = new Set((rosterAssignment || []).map((candidate) => candidate.badge));
  const uniqueRosterOwners = uniqueCreatureOwners(roster);
  const countHints = rosterCountHints(roster);
  const countOwnerHints = turnBarCountOwnerHints(roster);
  const countIdentityHints = turnBarExactCountIdentityHints(roster);
  const fallback = (candidateGroups || [])
    .filter((group) => rosterAssignment === null || !assignedBadges.has(group.badge))
    .map((group) => rosterAwareFallbackCandidate(
      group,
      uniqueRosterOwners,
      countHints,
      countOwnerHints,
      countIdentityHints
    ))
    .filter(isLegacyStackCandidate);
  if (rosterAssignment === null) return fallback.sort((left, right) => right.quality - left.quality);

  const rosterCandidates = new Set(rosterAssignment);
  return [...rosterAssignment, ...fallback].sort((left, right) =>
    Number(rosterCandidates.has(right)) - Number(rosterCandidates.has(left))
      || right.quality - left.quality
  );
}

function rosterAwareFallbackCandidate(group, uniqueRosterOwners, countHints, countOwnerHints, countIdentityHints) {
  const best = group?.best;
  const creatureId = Number(best?.creature?.creatureId ?? best?.creatureId);
  const observedCount = Math.trunc(Number(group?.badge?.count));
  const countOwner = Number.isInteger(observedCount) ? countOwnerHints.get(observedCount) : null;
  const exactCountCreatureId = countOwner && Number.isInteger(observedCount)
    ? countIdentityHints.get(`${countOwner}:${observedCount}`)
    : null;
  if (Number.isInteger(exactCountCreatureId)) {
    const exactCountCandidate = (group?.alternatives || [])
      .filter((candidate) => (
        candidate.owner === countOwner
        && Number(candidate?.creature?.creatureId ?? candidate?.creatureId) === exactCountCreatureId
        && isLegacyVisualCandidate(candidate)
      ))
      .sort((left, right) => Number(right.quality) - Number(left.quality))[0];
    if (exactCountCandidate) return exactCountCandidate;
  }
  if (countOwner && best?.owner === countOwner) return best;
  if (countOwner) {
    const bestQuality = Number(best?.quality);
    const ownerSupported = (group?.alternatives || [])
      .filter((candidate) => (
        candidate.owner === countOwner
        && isLegacyVisualCandidate(candidate)
        && Number(candidate.quality) >= bestQuality - ROSTER_VISUAL_QUALITY_TOLERANCE
      ))
      .sort((left, right) => Number(right.quality) - Number(left.quality))[0];
    if (ownerSupported) return ownerSupported;
  }
  const expectedOwner = uniqueRosterOwners.get(creatureId);
  if (expectedOwner && best?.owner === expectedOwner) return best;
  const bestVisualQuality = Number(best?.rawQuality ?? best?.quality);
  const rosterSupported = (group?.alternatives || [])
    .filter((candidate) => (
      uniqueRosterOwners.get(Number(candidate?.creature?.creatureId ?? candidate?.creatureId)) === candidate?.owner
      && isLegacyVisualCandidate(candidate)
      && Number(candidate.rawQuality ?? candidate.quality) >= bestVisualQuality - ROSTER_VISUAL_QUALITY_TOLERANCE
    ))
    .sort((left, right) => {
      const countMatchDifference = Number(rosterCandidateMatchesBadgeCount(right, group.badge, countHints))
        - Number(rosterCandidateMatchesBadgeCount(left, group.badge, countHints));
      const sameCreatureDifference = Number(
        Number(right?.creature?.creatureId ?? right?.creatureId) === creatureId
      ) - Number(Number(left?.creature?.creatureId ?? left?.creatureId) === creatureId);
      return countMatchDifference
        || sameCreatureDifference
        || Number(right.rawQuality ?? right.quality) - Number(left.rawQuality ?? left.quality);
    })[0];
  return rosterSupported
    ? { ...rosterSupported, quality: Number(rosterSupported.rawQuality ?? rosterSupported.quality) }
    : best;
}

function turnBarCountOwnerHints(roster) {
  const entries = Array.isArray(roster?.entries)
    ? roster.entries
    : (Array.isArray(roster?.lowerBoundRoster) ? roster.lowerBoundRoster : []);
  const ownersByCount = new Map();
  for (const entry of entries) {
    const owner = String(entry?.owner || "").toLowerCase();
    const count = Math.trunc(Number(entry?.count));
    if (!["player", "ai"].includes(owner) || !Number.isInteger(count) || count < 1) continue;
    if (!ownersByCount.has(count)) ownersByCount.set(count, new Set());
    ownersByCount.get(count).add(owner);
  }
  return new Map([...ownersByCount]
    .filter(([, owners]) => owners.size === 1)
    .map(([count, owners]) => [count, [...owners][0]]));
}

function turnBarExactCountIdentityHints(roster) {
  if (!Array.isArray(roster?.entries)) return new Map();
  const entriesByOwnerCount = new Map();
  for (const entry of roster.entries) {
    const owner = String(entry?.owner || "").toLowerCase();
    const count = Math.trunc(Number(entry?.count));
    if (!["player", "ai"].includes(owner) || !Number.isInteger(count) || count < 1) continue;
    const key = `${owner}:${count}`;
    if (!entriesByOwnerCount.has(key)) entriesByOwnerCount.set(key, []);
    entriesByOwnerCount.get(key).push(entry);
  }
  const result = new Map();
  for (const [key, entries] of entriesByOwnerCount) {
    const creatureIds = entries.map((entry) => {
      return integerCreatureId(entry?.creatureId);
    });
    if (creatureIds.every(Number.isInteger) && new Set(creatureIds).size === 1) {
      result.set(key, creatureIds[0]);
    }
  }
  return result;
}

function rosterCandidateMatchesBadgeCount(candidate, badge, countHints) {
  const observedCount = Math.trunc(Number(badge?.count));
  if (!Number.isInteger(observedCount) || observedCount < 1) return false;
  const creatureId = Number(candidate?.creature?.creatureId ?? candidate?.creatureId);
  return countHints.get(`${candidate?.owner}:${creatureId}`)?.has(observedCount) || false;
}

function uniqueCreatureOwners(roster) {
  const ownersByCreature = new Map();
  for (const key of rosterCapacities(roster).keys()) {
    const [owner, creatureIdText] = key.split(":");
    const creatureId = Number(creatureIdText);
    if (!ownersByCreature.has(creatureId)) ownersByCreature.set(creatureId, new Set());
    ownersByCreature.get(creatureId).add(owner);
  }
  return new Map([...ownersByCreature]
    .filter(([, owners]) => owners.size === 1)
    .map(([creatureId, owners]) => [creatureId, [...owners][0]]));
}

function isLegacyVisualCandidate(candidate) {
  return candidate?.correlation > 0.13
    && candidate.chroma > 0.82
    && Number(candidate.rawQuality ?? candidate.quality) > 0.34;
}

function isLegacyStackCandidate(candidate) {
  return candidate?.correlation > 0.13 && candidate.chroma > 0.82 && candidate.quality > 0.34;
}

function rosterCountHints(roster) {
  const hints = new Map();
  const entries = Array.isArray(roster?.lowerBoundRoster)
    ? roster.lowerBoundRoster
    : (Array.isArray(roster) ? roster : []);
  for (const entry of entries) {
    const owner = String(entry?.owner || "").toLowerCase();
    const creatureId = integerCreatureId(entry?.creatureId);
    const count = Math.trunc(Number(entry?.count));
    if (!["player", "ai"].includes(owner) || creatureId === null || !Number.isInteger(count) || count < 1) continue;
    const key = `${owner}:${creatureId}`;
    if (!hints.has(key)) hints.set(key, new Set());
    hints.get(key).add(count);
  }
  return hints;
}

function rosterCountEvidence(candidate, allowedCounts) {
  const observed = Math.trunc(Number(candidate?.badge?.count));
  if (!allowedCounts?.size || !Number.isInteger(observed) || observed < 1) return 0;
  const confidence = Math.max(0, Math.min(1, Number(candidate?.badge?.countDiagnostics?.selected?.score || 0.5)));
  return allowedCounts.has(observed) ? 0.3 * confidence : -0.2 * confidence;
}

function rosterCapacities(roster) {
  const capacities = new Map();
  const add = (owner, creatureId, multiplicity = 1) => {
    const normalizedOwner = String(owner || "").toLowerCase();
    const normalizedCreatureId = integerCreatureId(creatureId);
    const normalizedMultiplicity = Math.max(0, Math.floor(Number(multiplicity)));
    if (!["player", "ai"].includes(normalizedOwner) || normalizedCreatureId === null || !normalizedMultiplicity) return;
    const key = `${normalizedOwner}:${normalizedCreatureId}`;
    capacities.set(key, (capacities.get(key) || 0) + normalizedMultiplicity);
  };
  const addEntry = (entry, fallbackOwner) => {
    if (Number.isInteger(Number(entry))) return add(fallbackOwner, Number(entry), 1);
    if (!entry || typeof entry !== "object") return;
    add(
      entry.owner || fallbackOwner,
      entry.creatureId ?? entry.id,
      entry.instances ?? entry.multiplicity ?? entry.capacity ?? 1
    );
  };
  const addOwnerCollection = (owner, collection) => {
    if (Array.isArray(collection)) collection.forEach((entry) => addEntry(entry, owner));
    else if (collection && typeof collection === "object") {
      for (const [creatureId, multiplicity] of Object.entries(collection)) add(owner, creatureId, multiplicity);
    }
  };

  if (Array.isArray(roster)) roster.forEach((entry) => addEntry(entry));
  else if (roster && typeof roster === "object") {
    if (Array.isArray(roster.lowerBoundRoster)) roster.lowerBoundRoster.forEach((entry) => addEntry(entry));
    else if (Array.isArray(roster.entries)) roster.entries.forEach((entry) => addEntry(entry));
    else {
      addOwnerCollection("player", roster.player);
      addOwnerCollection("ai", roster.ai);
    }
  }
  return capacities;
}

function candidateQuality(candidate) {
  return Number(candidate?.quality ?? candidate?.score ?? candidate?.confidence);
}

function integerCreatureId(value) {
  if (value === null || value === undefined || value === "") return null;
  const creatureId = Number(value);
  return Number.isInteger(creatureId) ? creatureId : null;
}

function usageKey(usage) {
  return usage.join(",");
}

function isBetterAssignment(candidate, previous) {
  if (!previous) return true;
  // Once the caller's noise floor has removed implausible matches, roster
  // multiplicity is stronger evidence than a single unusually high sprite
  // correlation. Fill the maximum number of known stacks first, then choose
  // the highest-scoring assignment among solutions of that cardinality.
  if (candidate.assignments.length !== previous.assignments.length) {
    return candidate.assignments.length > previous.assignments.length;
  }
  return candidate.score > previous.score;
}

function representativeTemplates(templates) {
  if (templates.length <= 6) return templates;
  // DEF groups 0/2 cover ordinary movement and standing frames, while
  // groups 7-10 contain the upright turn/idle variants commonly frozen in a
  // combat screenshot. One representative per group makes the shortlist
  // animation-independent without exhaustively scoring every attack frame.
  const preferredGroups = new Set([0, 2, 7, 8, 9, 10]);
  const representatives = [];
  const seenGroups = new Set();
  for (const template of templates) {
    const groupId = Number(template.record.groupId);
    if (!preferredGroups.has(groupId) || seenGroups.has(groupId)) continue;
    representatives.push(template);
    seenGroups.add(groupId);
  }
  return representatives.length >= 3
    ? representatives
    : [templates[0], templates[Math.floor((templates.length - 1) / 2)], templates[templates.length - 1]];
}

function creatureTemplateScales(template) {
  // HD/HotA screenshots can render the battlefield at a different scale from
  // the fixed-resolution UI. Small DEFs are the most affected; testing three
  // bounded scales in the shortlist is substantially cheaper than resizing
  // every frame and prevents a 70% Pikeman from being labelled as a full-size
  // Griffin merely because their colors overlap.
  return template.image.width * template.image.height < 7000 ? [0.7, 0.85, 1] : [0.85, 1];
}

function scaledCreatureTemplate(template, scale) {
  if (scale === 1) return { ...template, templateScale: 1 };
  let variants = scaledCreatureTemplateCache.get(template);
  if (!variants) {
    variants = new Map();
    scaledCreatureTemplateCache.set(template, variants);
  }
  if (!variants.has(scale)) {
    variants.set(scale, {
      ...template,
      image: drawToCanvas(
        template.image,
        Math.max(1, Math.round(template.image.width * scale)),
        Math.max(1, Math.round(template.image.height * scale))
      ),
      record: {
        ...template.record,
        left: CREATURE_CANVAS_ANCHOR_X + (template.record.left - CREATURE_CANVAS_ANCHOR_X) * scale,
        top: CREATURE_CANVAS_ANCHOR_Y + (template.record.top - CREATURE_CANVAS_ANCHOR_Y) * scale
      },
      templateScale: scale
    });
  }
  return variants.get(scale);
}

function scoreCreatureTemplate(screen, background, grid, blocked, badgePlacement, template, coarse) {
  let best = null;
  const inheritedPrimary = !coarse
    && badgePlacement.creature?.creatureId === template.creature.creatureId
    && badgePlacement.primaryHex
    ? [badgePlacement.primaryHex]
    : null;
  for (const primaryHex of inheritedPrimary || creaturePrimaryHexHypotheses(grid, badgePlacement, template.creature)) {
    const hypothesis = { ...badgePlacement, primaryHex };
    const anchorHex = detectionAnchorHex(grid, hypothesis, template.creature);
    if (!anchorHex) continue;
    // Heroes III draws the 450x400 DEF canvas from a fixed battle-stack anchor.
    // Preserve the frame's internal left/top offsets; centering the cropped PNG
    // lets a large neighboring creature win the score for the wrong hex.
    const baseX = Math.round(anchorHex.centerX - CREATURE_CANVAS_ANCHOR_X + template.record.left);
    const baseY = Math.round(anchorHex.centerY - CREATURE_CANVAS_ANCHOR_Y + template.record.top);
    const inheritedAlignment = !coarse
      && badgePlacement.creature?.creatureId === template.creature.creatureId
      && badgePlacement.primaryHex?.id === primaryHex.id;
    const originX = baseX + (inheritedAlignment ? Number(badgePlacement.alignmentDx || 0) : 0);
    const originY = baseY + (inheritedAlignment ? Number(badgePlacement.alignmentDy || 0) : 0);
    const placement = bestCompositePlacement(screen, background, template.image, originX, originY, {
      // The coarse pass covers normalization/crop drift in a 15-position
      // lattice. The fine pass inherits that translation and checks only the
      // surrounding 3x3 pixels for every animation frame.
      radiusX: coarse ? 6 : 1,
      radiusY: coarse ? 3 : 1,
      step: coarse ? 3 : 1,
      fixedFlip: badgePlacement.owner === "ai",
      sampleStep: coarse ? 4 : 2
    });
    const rawQuality = creatureMatchQuality(placement);
    const sidePenalty = ownerSidePenalty(badgePlacement.owner, primaryHex);
    const badgePenalty = Math.min(0.08, Math.hypot(badgePlacement.dx, badgePlacement.dy) * 0.0025);
    const quality = rawQuality - sidePenalty - badgePenalty;
    const candidate = {
      ...badgePlacement,
      primaryHex,
      ...placement,
      creature: template.creature,
      quality,
      rawQuality,
      sidePenalty,
      badgePenalty,
      templateScale: template.templateScale || 1,
      alignmentDx: placement.x - baseX,
      alignmentDy: placement.y - baseY
    };
    if (!best || candidate.quality > best.quality) best = candidate;
  }
  return best;
}

function locateBadgeOnGrid(badge, grid, owner) {
  // Native count boxes are moved outside the battle edge: attacker boxes are
  // one cell to the right, defender boxes one cell to the left. These offsets
  // are measured from the exact 45x52 cell raster center after normalization.
  const badgeOffsetX = owner === "ai" ? -37.5 : 37;
  const badgeOffsetY = owner === "ai" ? -9 : 6;
  let best = null;
  for (const hex of grid.hexes) {
    const dx = badge.centerX - (hex.centerX + badgeOffsetX);
    const dy = badge.centerY - (hex.centerY + badgeOffsetY);
    const distance = dx * dx + dy * dy;
    if (!best || distance < best.distance) best = { primaryHex: hex, badgeAnchorHex: hex, owner, distance, dx, dy };
  }
  return best && Math.abs(best.dx) <= 18 && Math.abs(best.dy) <= 20 ? best : null;
}

function creaturePrimaryHexHypotheses(grid, placement, creature) {
  const badgeAnchorHex = placement.badgeAnchorHex || placement.primaryHex;
  const candidates = [badgeAnchorHex];
  if (inferAbilityFlags(creature).twoHex) {
    // The badge is attached to the visually trailing half in some DEFs. Only
    // wide creatures need this second legal hypothesis, avoiding the previous
    // 3x cost for every template while retaining exact template verification.
    const primaryCol = badgeAnchorHex.col + (placement.owner === "ai" ? -1 : 1);
    const adjacentPrimary = grid.hexes.find((hex) => hex.row === badgeAnchorHex.row && hex.col === primaryCol);
    if (adjacentPrimary) candidates.push(adjacentPrimary);
  }
  return candidates.filter((primaryHex) => {
    const stackLike = { creature, owner: placement.owner, hexId: primaryHex.id };
    return Boolean(footprintHexes(grid, stackLike));
  });
}

function detectionAnchorHex(grid, placement, creature) {
  if (placement.owner !== "player" || !inferAbilityFlags(creature).twoHex) return placement.primaryHex;
  return grid.hexes.find((hex) => hex.row === placement.primaryHex.row && hex.col === placement.primaryHex.col - 1) || null;
}

function creatureMatchQuality(placement) {
  const correlation = Math.max(0, placement.correlation);
  const chroma = Math.max(0, placement.chroma);
  const match = Math.max(0, placement.match);
  const signedGain = Math.max(-1, Math.min(1, placement.gain));
  return correlation * 0.15 + chroma * 0.15 + match * 0.45 + signedGain * 0.25;
}

function obstacleMatchQuality(placement) {
  return Math.max(0, placement.correlation) * 0.5
    + Math.max(0, placement.match) * 0.3
    + Math.max(-1, Math.min(1, placement.gain)) * 0.2;
}

function anchoredObstacleMatchQuality(placement) {
  return obstacleMatchQuality(placement) - Math.min(100, placement.anchorDistance || 0) * 0.004;
}

function obstacleTemplateRecord(image, left, top, flip = false) {
  if (!image) return null;
  let variants = templatePixelCache.get(image);
  if (!variants) {
    variants = new Map();
    templatePixelCache.set(image, variants);
  }
  if (!variants.has(Boolean(flip))) {
    const templateCanvas = drawToCanvas(image, image.width, image.height, Boolean(flip));
    variants.set(Boolean(flip), templateCanvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, image.width, image.height).data);
  }
  return {
    pixels: variants.get(Boolean(flip)),
    width: image.width,
    height: image.height,
    left,
    top
  };
}

function ownerSidePenalty(owner, primaryHex) {
  const wrongSideDistance = owner === "ai"
    ? Math.max(0, WIDTH / 2 - primaryHex.centerX)
    : Math.max(0, primaryHex.centerX - WIDTH / 2);
  return 0.3 * wrongSideDistance / (WIDTH / 2);
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
  return best?.score >= 0.4 ? best : null;
}

function selectBadgeCount(smooth, sharp) {
  if (!smooth) return sharp;
  if (!sharp) return smooth;
  if (smooth.value === sharp.value) return smooth.score >= sharp.score ? smooth : sharp;
  return smooth.score + 0.03 >= sharp.score ? smooth : sharp;
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
    // A normalized Heroes III count badge is a short horizontal bar. Purple
    // creature/shadow fragments can form similarly sized blobs, but they are
    // close to square or much taller (the browser false-positive was 19x18).
    if (area >= 40 && width >= 15 && width <= 48 && height >= 5 && height <= 12 && width >= height * 1.35) {
      badges.push({ minX, minY, width, height, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 });
    }
  }
  // The yellow active-stack outline can touch the purple badge and make its
  // connected component too tall. Heroes III still draws the independent
  // two-pixel green HP baseline, so recover those selected badges from that
  // invariant without loosening the purple-fragment filter globally.
  for (const baseline of detectBadgeBaselines(pixels)) {
    const minY = baseline.minY - 10;
    if (minY < 0) continue;
    const overlappingBadge = badges.find((badge) => {
      const overlapX = Math.min(badge.minX + badge.width, baseline.minX + baseline.width)
        - Math.max(badge.minX, baseline.minX);
      return overlapX > 0 && Math.abs(badge.minY - minY) <= 3;
    });
    if (overlappingBadge) {
      // A creature/obstacle can split the purple component while the green HP
      // baseline remains intact. Keeping the short component crops the digit
      // (the real Sandworm regression read a clipped 3 as 8). Expand only
      // when the independent baseline is substantially wider, so ordinary
      // one-pixel component/baseline differences remain untouched.
      if (baseline.width >= overlappingBadge.width + 6
          && baseline.width >= overlappingBadge.width * 1.35) {
        overlappingBadge.minX = baseline.minX;
        overlappingBadge.minY = minY;
        overlappingBadge.width = baseline.width;
        overlappingBadge.height = 9;
        overlappingBadge.centerX = baseline.minX + (baseline.width - 1) / 2;
        overlappingBadge.centerY = minY + 4;
      }
      continue;
    }
    badges.push({
      minX: baseline.minX,
      minY,
      width: baseline.width,
      height: 9,
      centerX: baseline.minX + (baseline.width - 1) / 2,
      centerY: minY + 4
    });
  }
  return badges;
}

function detectBadgeBaselines(pixels) {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let index = 0; index < mask.length; index += 1) {
    const pixel = index * 4;
    const red = pixels[pixel];
    const green = pixels[pixel + 1];
    const blue = pixels[pixel + 2];
    if (green > 80 && green > red * 1.25 && green > blue * 1.25) mask[index] = 1;
  }
  const visited = new Uint8Array(mask.length);
  const baselines = [];
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
        if (Math.abs((neighbor % WIDTH) - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width >= 24 && width <= 48 && height >= 1 && height <= 3 && area >= width * 1.5) {
      baselines.push({ minX, minY, width, height });
    }
  }
  return baselines;
}

function bestCompositePlacement(screen, background, image, originX, originY, options) {
  let best = { gain: -1, match: 0, correlation: -1, chroma: 0, x: originX, y: originY, flip: false };
  const flips = typeof options.fixedFlip === "boolean"
    ? [options.fixedFlip]
    : (options.allowFlip ? [false, true] : [false]);
  for (const flip of flips) {
    const orientedOriginX = originX + (flip ? Number(options.flipOffsetX || 0) : 0);
    for (let dy = -options.radiusY; dy <= options.radiusY; dy += options.step) {
      for (let dx = -options.radiusX; dx <= options.radiusX; dx += options.step) {
        const score = compositeScore(
          screen,
          background,
          image,
          orientedOriginX + dx,
          originY + dy,
          flip,
          options.sampleStep,
          options.ignoreForegroundOcclusion
        );
        const scoreRank = options.rankByObstacleQuality ? obstacleMatchQuality(score) : score.correlation;
        const bestRank = options.rankByObstacleQuality ? obstacleMatchQuality(best) : best.correlation;
        if (scoreRank > bestRank || (scoreRank === bestRank && score.correlation > best.correlation)) {
          best = { ...score, x: orientedOriginX + dx, y: originY + dy, flip };
        }
      }
    }
  }
  return best;
}

function compositeScore(screenContext, backgroundContext, image, x, y, flip, step, ignoreForegroundOcclusion = false) {
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
  const cleanBackground = contextPixels(backgroundContext.cleanCompositeBackground || backgroundContext);
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
  let opaquePixels = 0;
  let retainedPixels = 0;
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
      opaquePixels += 1;
      let pixelBaselineError = 0;
      let pixelCandidateError = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = background[si + channel];
        const cleanBase = cleanBackground[si + channel];
        const shade = cleanBase >= 12 ? Math.max(0.2, Math.min(1.2, base / cleanBase)) : 1;
        const expected = template[ti + channel] * alpha * shade + base * (1 - alpha);
        pixelBaselineError += Math.abs(screen[si + channel] - base);
        pixelCandidateError += Math.abs(screen[si + channel] - expected);
      }
      // A foreground creature can cover part of a legitimate obstacle. Such
      // pixels differ strongly from both the empty terrain and the obstacle
      // template, so exclude them from obstacle-only scoring while retaining
      // a majority-coverage requirement below.
      if (ignoreForegroundOcclusion && pixelBaselineError > 150 && pixelCandidateError > 150) continue;
      retainedPixels += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = background[si + channel];
        const cleanBase = cleanBackground[si + channel];
        const shade = cleanBase >= 12 ? Math.max(0.2, Math.min(1.2, base / cleanBase)) : 1;
        const expected = template[ti + channel] * alpha * shade + base * (1 - alpha);
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
  if (
    !samples
    || baselineError < samples * 2
    // A large creature may hide most of an obstacle. Keep a conservative
    // absolute sample floor, but allow the visible 22% consensus to identify
    // the underlying native template.
    || (ignoreForegroundOcclusion && (retainedPixels < 18 || retainedPixels < opaquePixels * 0.22))
  ) return { gain: -1, match: 0, correlation: -1, chroma: 0 };
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

export function inferTerrain(background) {
  if (background?.terrain) return String(background.terrain).trim().toLowerCase();
  const exactTerrain = BACKGROUND_TERRAIN_BY_ID.get(String(background?.id || "").toLowerCase());
  if (exactTerrain) return exactTerrain;
  const text = `${background.id} ${background.name}`.toLowerCase();
  if (text.includes("wasteland")) return "wasteland";
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

function templateAlphaDensity(image) {
  if (templateAlphaDensityCache.has(image)) return templateAlphaDensityCache.get(image);
  const pixels = drawToCanvas(image, image.width, image.height)
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, image.width, image.height).data;
  let opaque = 0;
  let samples = 0;
  for (let index = 3; index < pixels.length; index += 16) {
    if (pixels[index] > 76) opaque += 1;
    samples += 1;
  }
  const density = samples ? opaque / samples : 0;
  templateAlphaDensityCache.set(image, density);
  return density;
}

function loadImage(src) {
  if (imagePromiseCache.has(src)) return imagePromiseCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
  imagePromiseCache.set(src, promise);
  return promise;
}
