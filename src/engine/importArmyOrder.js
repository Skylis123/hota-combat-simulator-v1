import { ARMY_SLOT_COUNT, deploymentRows } from "./armyDeployment.js";

/**
 * Reconstructs setup slots from the vertical positions observed in an
 * imported battlefield screenshot.
 *
 * Visually anchored stacks keep their top-to-bottom order and are assigned
 * monotonically to the closest rows from the native 1-7 stack deployment.
 * Roster-only stacks then fill the gaps left by that assignment. This is
 * intentionally different from appending turn-bar-only stacks after every
 * visible stack: the turn bar is ordered by initiative, not by army slot.
 */
export function assignImportedArmySlots(grid, stacks) {
  for (const owner of ["player", "ai"]) assignOwnerSlots(grid, stacks, owner);
  return stacks;
}

export function assignOwnerSlots(grid, stacks, owner) {
  const indexed = (stacks || [])
    .map((stack, inputIndex) => ({ stack, inputIndex }))
    .filter(({ stack }) => stack.owner === owner);
  if (!indexed.length) return [];

  // The simulator and Heroes III deployment both cap an army at seven stacks.
  // Keeping this guard here makes the helper deterministic even for malformed
  // imported data; overflow stacks retain a stable order after the first seven.
  const deployable = indexed.slice(0, ARMY_SLOT_COUNT);
  const overflow = indexed.slice(ARMY_SLOT_COUNT);
  const rows = deploymentRows(deployable.length);
  const lookup = new Map((grid?.hexes || []).map((hex) => [Number(hex.id), hex]));
  const anchored = [];
  const unanchored = [];

  for (const item of deployable) {
    const sourceHexId = importedSourceHexId(item.stack);
    const sourceHex = sourceHexId === null ? null : lookup.get(sourceHexId);
    if (Number.isFinite(Number(sourceHex?.row))) {
      anchored.push({
        ...item,
        sourceHexId,
        sourceRow: Number(sourceHex.row),
        sourceCol: Number.isFinite(Number(sourceHex.col)) ? Number(sourceHex.col) : 0
      });
    } else {
      unanchored.push(item);
    }
  }

  anchored.sort(compareAnchored);
  const anchoredSlots = monotonicRowAssignment(
    anchored.map((item) => item.sourceRow),
    rows
  );
  const usedSlots = new Set();
  anchored.forEach((item, index) => {
    const slot = anchoredSlots[index];
    if (!Number.isInteger(slot)) return;
    item.stack.armySlot = slot;
    usedSlots.add(slot);
  });

  const freeSlots = rows.map((_, slot) => slot).filter((slot) => !usedSlots.has(slot));
  unanchored
    .sort(compareStableRosterOrder)
    .forEach((item, index) => {
      item.stack.armySlot = freeSlots[index];
    });

  overflow
    .sort(compareStableRosterOrder)
    .forEach((item, index) => {
      item.stack.armySlot = ARMY_SLOT_COUNT + index;
    });

  return deployable
    .map(({ stack }) => stack)
    .sort((left, right) => Number(left.armySlot) - Number(right.armySlot));
}

/**
 * A roster-only stack receives a temporary fallback hex when it is created.
 * That hex is not screenshot evidence and must never pull it towards the
 * middle deployment row. A dedicated screenshot source anchor, when present,
 * is authoritative; otherwise only a genuinely visible stack may use hexId.
 */
export function importedSourceHexId(stack) {
  const explicit = integerId(stack?.screenshotSourceHexId);
  if (explicit !== null) return explicit;
  if (stack?.screenshotRosterOnly) return null;
  return integerId(stack?.hexId);
}

/**
 * Assigns ordered observed rows to an ordered subset of canonical deployment
 * rows. Dynamic programming is used instead of nearest-row greedy assignment,
 * because two observations may prefer the same canonical row. The result is a
 * strictly increasing list of slot indexes.
 */
export function monotonicRowAssignment(observedRows, canonicalRows) {
  const observed = (observedRows || []).map(Number);
  const canonical = (canonicalRows || []).map(Number);
  if (!observed.length) return [];
  if (observed.length > canonical.length) return [];

  const memo = new Map();
  const solve = (observedIndex, minimumSlot) => {
    if (observedIndex >= observed.length) return { cost: 0, slots: [] };
    const key = `${observedIndex}:${minimumSlot}`;
    if (memo.has(key)) return memo.get(key);

    const remainingAfter = observed.length - observedIndex - 1;
    const lastSlot = canonical.length - remainingAfter - 1;
    let best = null;
    for (let slot = minimumSlot; slot <= lastSlot; slot += 1) {
      const tail = solve(observedIndex + 1, slot + 1);
      if (!tail) continue;
      const delta = observed[observedIndex] - canonical[slot];
      const candidate = {
        // Squared row distance rewards exact native rows and makes leaving a
        // real gap cheaper than shifting every lower stack by one position.
        cost: delta * delta + tail.cost,
        slots: [slot, ...tail.slots]
      };
      if (betterAssignment(candidate, best)) best = candidate;
    }
    memo.set(key, best);
    return best;
  };

  return solve(0, 0)?.slots || [];
}

function compareAnchored(left, right) {
  return left.sourceRow - right.sourceRow
    || left.sourceCol - right.sourceCol
    || compareStableRosterOrder(left, right);
}

function compareStableRosterOrder(left, right) {
  return finiteSortValue(left.stack.armySlot) - finiteSortValue(right.stack.armySlot)
    || finiteSortValue(left.stack.createdAt) - finiteSortValue(right.stack.createdAt)
    || left.inputIndex - right.inputIndex;
}

function finiteSortValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function integerId(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function betterAssignment(candidate, previous) {
  if (!previous || candidate.cost !== previous.cost) return !previous || candidate.cost < previous.cost;
  // A lexicographic tie-break is stable across engines and input-array order.
  for (let index = 0; index < candidate.slots.length; index += 1) {
    if (candidate.slots[index] !== previous.slots[index]) {
      return candidate.slots[index] < previous.slots[index];
    }
  }
  return false;
}
