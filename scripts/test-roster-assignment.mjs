import assert from "node:assert/strict";
import {
  applyRosterCounts,
  assignStackCandidatesToRoster,
  mergeRosterAssignmentsWithFallback
} from "../src/engine/screenshotAnalyzer.js";

function candidate(label, owner, creatureId, quality) {
  return { label, owner, creature: { creatureId }, quality };
}

const globallyAmbiguous = [
  {
    alternatives: [
      candidate("a-pikeman", "player", 0, 0.9),
      candidate("a-halberdier", "player", 1, 0.89)
    ]
  },
  {
    alternatives: [
      candidate("b-pikeman", "player", 0, 0.88),
      candidate("b-halberdier", "player", 1, 0.1)
    ]
  }
];
const globalResult = assignStackCandidatesToRoster(globallyAmbiguous, {
  lowerBoundRoster: [
    { owner: "player", creatureId: 0, instances: 1 },
    { owner: "player", creatureId: 1, instances: 1 }
  ]
});
assert.deepEqual(
  globalResult.map((entry) => entry.label),
  ["a-halberdier", "b-pikeman"],
  "Roster assignment must maximize all badges together instead of consuming the first badge greedily."
);

const ownerResult = assignStackCandidatesToRoster([
  {
    alternatives: [
      candidate("player", "player", 0, 0.75),
      candidate("wrong-owner", "ai", 0, 0.8)
    ]
  },
  { alternatives: [candidate("ai", "ai", 0, 0.7)] }
], {
  player: [{ creatureId: 0 }],
  ai: [{ creatureId: 0 }]
});
assert.deepEqual(ownerResult.map((entry) => entry.label), ["player", "ai"], "Owner capacities must be independent.");

const factoryResult = assignStackCandidatesToRoster([
  {
    alternatives: [
      candidate("factory-grenadier", "player", 171, 0.91),
      candidate("castle-archer", "player", 2, 0.7)
    ]
  },
  {
    alternatives: [
      candidate("factory-bounty-hunter", "ai", 181, 0.9),
      candidate("castle-marksman", "ai", 3, 0.72)
    ]
  }
], {
  lowerBoundRoster: [
    { owner: "player", creatureId: 171, instances: 1 },
    { owner: "ai", creatureId: 181, instances: 1 }
  ]
});
assert.deepEqual(
  factoryResult.map((entry) => entry.label),
  ["factory-grenadier", "factory-bounty-hunter"],
  "Screenshot roster assignment must preserve Factory creature IDs and owners."
);

const multiplicityResult = assignStackCandidatesToRoster([
  { alternatives: [candidate("first", "player", 0, 0.7)] },
  { alternatives: [candidate("second", "player", 0, 0.6)] },
  { alternatives: [candidate("third", "player", 0, 0.5)] }
], [
  // `count` is the number of creatures in each stack, not the number of
  // stack instances available to the assignment.
  { owner: "player", creatureId: 0, count: 20, instances: 2 }
]);
assert.deepEqual(multiplicityResult.map((entry) => entry.label), ["first", "second"]);

const thresholdResult = assignStackCandidatesToRoster([
  { alternatives: [candidate("weak", "player", 0, 0.19)] },
  { alternatives: [candidate("usable", "player", 0, 0.2)] }
], [{ owner: "player", creatureId: 0, instances: 2 }], { minimumQuality: 0.2 });
assert.deepEqual(thresholdResult.map((entry) => entry.label), ["usable"]);

const cardinalityResult = assignStackCandidatesToRoster([
  {
    alternatives: [
      candidate("first-high", "player", 0, 0.8),
      candidate("first-low", "player", 1, 0.3)
    ]
  },
  { alternatives: [candidate("second-low", "player", 0, 0.3)] }
], [
  { owner: "player", creatureId: 0, instances: 1 },
  { owner: "player", creatureId: 1, instances: 1 }
], { minimumQuality: 0.2 });
assert.deepEqual(
  cardinalityResult.map((entry) => entry.label),
  ["first-low", "second-low"],
  "Above the noise floor, filling both roster stacks must beat one unusually strong match."
);

assert.equal(assignStackCandidatesToRoster(globallyAmbiguous, null), null, "No roster must preserve the caller's legacy fallback.");

const knownBadge = { id: "known" };
const extraBadge = { id: "extra" };
const knownCandidate = {
  ...candidate("known-pikeman", "player", 0, 0.5),
  badge: knownBadge,
  correlation: 0.2,
  chroma: 0.9
};
const extraCandidate = {
  ...candidate("extra-archer", "player", 4, 0.45),
  badge: extraBadge,
  correlation: 0.2,
  chroma: 0.9
};
const weakExtraCandidate = {
  ...candidate("weak-extra", "player", 5, 0.33),
  badge: { id: "weak-extra" },
  correlation: 0.2,
  chroma: 0.9
};
const partialRosterMerge = mergeRosterAssignmentsWithFallback([
  { badge: knownBadge, best: knownCandidate },
  { badge: extraBadge, best: extraCandidate },
  { badge: weakExtraCandidate.badge, best: weakExtraCandidate }
], [knownCandidate]);
assert.deepEqual(
  partialRosterMerge.map((entry) => entry.label),
  ["known-pikeman", "extra-archer"],
  "A lower-bound roster must prioritize known stacks without deleting strict visual matches for clipped or unknown cards."
);

const importedStack = {
  owner: "player",
  creature: { creatureId: 0, stats: { hp: 10 } },
  count: 20,
  initialCount: 20,
  hpTotal: 200,
  wound: 0,
  screenshotCountRecognized: true
};
applyRosterCounts([importedStack], {
  lowerBoundRoster: [{ owner: "player", creatureId: 0, count: null, instances: 1 }]
});
assert.equal(importedStack.count, 20, "An unknown turn-bar count must not overwrite a recognized battlefield count with 1.");

console.log("Roster-constrained screenshot candidate assignment tests passed.");
