import assert from "node:assert/strict";
import {
  assignImportedArmySlots,
  importedSourceHexId,
  monotonicRowAssignment
} from "../src/engine/importArmyOrder.js";

const grid = {
  hexes: Array.from({ length: 11 }, (_, row) => ({ id: row * 15, row, col: 0 }))
};

function stack(name, owner, sourceRow, armySlot, options = {}) {
  const visible = Number.isInteger(sourceRow);
  return {
    id: `${owner}-${name}`,
    creature: { name },
    owner,
    armySlot,
    createdAt: options.createdAt ?? armySlot,
    // Roster-only stacks currently receive row 5 as a temporary creation hex.
    // The order helper must ignore it unless a real source anchor is supplied.
    hexId: visible ? sourceRow * 15 : 5 * 15,
    ...(visible ? { screenshotSourceHexId: sourceRow * 15 } : {}),
    ...(options.rosterOnly ? { screenshotRosterOnly: true } : {})
  };
}

// Regression from c906...: five badge-backed Player stacks were recovered at
// rows 0/4/6/8/10, while Sandworm and Juggernaut were completed from the turn
// bar. Appending them produced the wrong order. Native seven-stack rows are
// 0/2/4/5/6/8/10, so the two exact gaps are slots 1 and 3.
const c906Player = [
  stack("Halfling", "player", 0, 0),
  stack("Sentinel Automaton", "player", 6, 2),
  stack("Olgoi-Khorkhoi", "player", 8, 3),
  stack("Halfling Grenadier", "player", 10, 4),
  stack("Sandworm", "player", null, 5, { rosterOnly: true }),
  stack("Automaton", "player", 4, 1),
  stack("Juggernaut", "player", null, 6, { rosterOnly: true })
];
assignImportedArmySlots(grid, c906Player);
assert.deepEqual(
  [...c906Player]
    .sort((left, right) => left.armySlot - right.armySlot)
    .map((entry) => `${entry.armySlot}:${entry.creature.name}`),
  [
    "0:Halfling",
    "1:Sandworm",
    "2:Automaton",
    "3:Juggernaut",
    "4:Sentinel Automaton",
    "5:Olgoi-Khorkhoi",
    "6:Halfling Grenadier"
  ],
  "Roster-only stacks must fill spatial gaps instead of being appended below every visible Player stack."
);

assert.equal(
  importedSourceHexId(c906Player.find((entry) => entry.creature.name === "Sandworm")),
  null,
  "A roster-only fallback hex is not a source battlefield observation."
);
assert.equal(importedSourceHexId({ screenshotSourceHexId: null, hexId: null }), null);

// A fully visible army maps exactly and independently on the AI side.
const mixedOwners = [
  stack("P top", "player", 2, 0),
  stack("P bottom", "player", 8, 1),
  stack("A top", "ai", 0, 4),
  stack("A upper", "ai", 2, 3),
  stack("A center", "ai", 5, 2),
  stack("A lower", "ai", 8, 1),
  stack("A bottom", "ai", 10, 0)
];
assignImportedArmySlots(grid, mixedOwners);
assert.deepEqual(
  mixedOwners.filter((entry) => entry.owner === "ai")
    .sort((left, right) => left.armySlot - right.armySlot)
    .map((entry) => entry.creature.name),
  ["A top", "A upper", "A center", "A lower", "A bottom"]
);
assert.deepEqual(
  mixedOwners.filter((entry) => entry.owner === "player")
    .sort((left, right) => left.armySlot - right.armySlot)
    .map((entry) => entry.creature.name),
  ["P top", "P bottom"]
);

// Without any spatial evidence, retain the roster's stable order while filling
// all available slots. Input-array shuffling must not change the result.
const hidden = [
  stack("third", "player", null, 2, { rosterOnly: true, createdAt: 2 }),
  stack("first", "player", null, 0, { rosterOnly: true, createdAt: 0 }),
  stack("second", "player", null, 1, { rosterOnly: true, createdAt: 1 })
];
assignImportedArmySlots(grid, hidden);
assert.deepEqual(
  [...hidden].sort((left, right) => left.armySlot - right.armySlot).map((entry) => entry.creature.name),
  ["first", "second", "third"]
);

// The DP must preserve observation order even when greedy nearest-row choices
// would compete for the same native row.
const assignment = monotonicRowAssignment([1, 4, 6, 9], [0, 4, 6, 10]);
assert.deepEqual(assignment, [0, 1, 2, 3]);
assert.ok(assignment.every((slot, index) => index === 0 || slot > assignment[index - 1]));

// Explicit source evidence wins over a later working hex (for example after a
// caller has prepared deployment but still needs to reconstruct army slots).
const explicitSource = stack("explicit", "player", 2, 0);
explicitSource.hexId = 8 * 15;
assert.equal(importedSourceHexId(explicitSource), 2 * 15);

console.log("Imported army spatial-order reconstruction tests passed.");
