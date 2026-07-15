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

const knownWormBadge = { id: "known-worm" };
const extraWormBadge = { id: "extra-worm" };
const knownWorm = {
  ...candidate("known-ai-worm", "ai", 178, 0.66),
  badge: knownWormBadge,
  correlation: 0.5,
  chroma: 0.95,
  rawQuality: 0.66
};
const sideBiasedWorm = {
  ...candidate("left-side-player-worm", "player", 178, 0.62),
  badge: extraWormBadge,
  correlation: 0.5,
  chroma: 0.95,
  rawQuality: 0.62
};
const ownerCorrectedWorm = {
  ...candidate("left-side-ai-worm", "ai", 178, 0.37),
  badge: extraWormBadge,
  correlation: 0.5,
  chroma: 0.95,
  rawQuality: 0.62
};
const partialEnemyQueueMerge = mergeRosterAssignmentsWithFallback([
  { badge: knownWormBadge, best: knownWorm, alternatives: [knownWorm] },
  { badge: extraWormBadge, best: sideBiasedWorm, alternatives: [sideBiasedWorm, ownerCorrectedWorm] }
], [knownWorm], {
  lowerBoundRoster: [{ owner: "ai", creatureId: 178, instances: 1 }]
});
assert.deepEqual(
  partialEnemyQueueMerge.map((entry) => entry.label),
  ["known-ai-worm", "left-side-ai-worm"],
  "A partial turn bar must correct the owner of additional strict visual matches without treating queue multiplicity as a maximum."
);

const visuallyBiasedBadge = { id: "visually-biased-worm", count: 3 };
const falseMonk = {
  ...candidate("false-left-monk", "player", 8, 0.72),
  badge: visuallyBiasedBadge,
  correlation: 0.45,
  chroma: 0.95,
  rawQuality: 0.77
};
const rosterSupportedWorm = {
  ...candidate("roster-supported-ai-worm", "ai", 178, 0.61),
  badge: visuallyBiasedBadge,
  correlation: 0.5,
  chroma: 0.95,
  rawQuality: 0.72
};
const higherRawMechanic = {
  ...candidate("higher-raw-player-mechanic", "player", 172, 0.66),
  badge: visuallyBiasedBadge,
  correlation: 0.48,
  chroma: 0.95,
  rawQuality: 0.75
};
const creatureCorrectedQueueMerge = mergeRosterAssignmentsWithFallback([
  { badge: visuallyBiasedBadge, best: falseMonk, alternatives: [falseMonk, higherRawMechanic, rosterSupportedWorm] }
], [], {
  lowerBoundRoster: [
    { owner: "player", creatureId: 172, count: 6, instances: 1 },
    { owner: "ai", creatureId: 178, count: 3, instances: 1 }
  ]
});
assert.deepEqual(
  creatureCorrectedQueueMerge.map((entry) => entry.label),
  ["roster-supported-ai-worm"],
  "A strong roster-supported creature match must beat an unrelated side-biased fallback even after that queue stack already acted."
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

const peerCountStacks = [
  { ...importedStack, count: 3, screenshotCountRecognized: true },
  { ...importedStack, count: 3, screenshotCountRecognized: true },
  { ...importedStack, count: 4, screenshotCountRecognized: true },
  { ...importedStack, count: 1, screenshotCountRecognized: false }
];
applyRosterCounts(peerCountStacks, { lowerBoundRoster: [] });
assert.equal(peerCountStacks[3].count, 3, "A uniquely repeated peer count must fill one unread badge of the same owner and creature.");
assert.equal(peerCountStacks[3].screenshotCountInferredFromPeers, true);

console.log("Roster-constrained screenshot candidate assignment tests passed.");
