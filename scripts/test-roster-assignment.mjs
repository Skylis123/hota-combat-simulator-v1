import assert from "node:assert/strict";
import {
  applyRosterCounts,
  assignStackCandidatesToRoster,
  completeTurnRosterOwners,
  completeStacksFromTurnRoster,
  hasCompleteTurnRoster,
  mergeRosterAssignmentsWithFallback
} from "../src/engine/screenshotAnalyzer.js";

function candidate(label, owner, creatureId, quality) {
  return { label, owner, creature: { creatureId }, quality };
}

const completeRoster = {
  lowerBoundRoster: [
    ...Array.from({ length: 7 }, (_, creatureId) => ({ owner: "player", creatureId, instances: 1 })),
    { owner: "ai", creatureId: 5, instances: 7 }
  ]
};
assert.equal(hasCompleteTurnRoster(completeRoster), true, "A proven 7+7 queue must be treated as an exact army inventory.");
assert.equal(hasCompleteTurnRoster({
  lowerBoundRoster: completeRoster.lowerBoundRoster.filter((entry) => entry.owner !== "player" || entry.creatureId !== 6)
}), false, "A queue missing even one player stack must remain a conservative lower bound.");
assert.deepEqual(
  [...completeTurnRosterOwners({ lowerBoundRoster: completeRoster.lowerBoundRoster.slice(0, 7) })],
  ["player"],
  "A complete player queue must be usable even if faster enemy stacks already left the visible current-round segment."
);
assert.deepEqual(
  [...completeTurnRosterOwners({ lowerBoundRoster: [{ owner: "ai", creatureId: null, instances: 7 }] })],
  [],
  "Seven unidentified queue cards must not become a complete Pikeman roster through null coercion."
);
assert.equal(
  assignStackCandidatesToRoster([], { lowerBoundRoster: [{ owner: "ai", creatureId: null, instances: 7 }] }),
  null,
  "Unknown queue identities must not create a creatureId 0 roster capacity."
);

const animatedBadge = { id: "animated-factory-stack", count: 1 };
const wrongAnimatedVisual = {
  ...candidate("animation-lookalike-griffin", "player", 4, 0.74),
  badge: animatedBadge
};
const exactAnimatedRoster = {
  ...candidate("queue-proven-automaton", "player", 176, 0.62),
  badge: animatedBadge
};
assert.deepEqual(
  assignStackCandidatesToRoster([{
    badge: animatedBadge,
    best: wrongAnimatedVisual,
    alternatives: [wrongAnimatedVisual, exactAnimatedRoster]
  }], [{ owner: "player", creatureId: 176, instances: 1 }], {
    maxVisualQualityDrop: 0.04,
    allowMaterialVisualDrop: (entry) => entry.owner === "player"
  }).map((entry) => entry.label),
  ["queue-proven-automaton"],
  "An exact owner inventory must survive a different idle-animation frame."
);

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

const strongPikemanBadge = { id: "strong-pikeman", count: 19 };
const strongVisualPikeman = {
  ...candidate("strong-visual-pikeman", "ai", 0, 0.668),
  rawQuality: 0.668,
  badge: strongPikemanBadge,
  correlation: 0.55,
  chroma: 0.95
};
const weakerRosterHalberdier = {
  ...candidate("weaker-roster-halberdier", "ai", 1, 0.606),
  rawQuality: 0.606,
  badge: strongPikemanBadge,
  correlation: 0.45,
  chroma: 0.95
};
const conservativeRoster = {
  lowerBoundRoster: [{ owner: "ai", creatureId: 1, count: 18, instances: 1 }]
};
const conservativeAssignment = assignStackCandidatesToRoster([{
  badge: strongPikemanBadge,
  best: strongVisualPikeman,
  alternatives: [strongVisualPikeman, weakerRosterHalberdier]
}], conservativeRoster, {
  minimumQuality: -0.15,
  maxVisualQualityDrop: 0.04
});
assert.deepEqual(
  conservativeAssignment,
  [],
  "A roster capacity must not relabel a materially stronger visual creature when its count also disagrees."
);
assert.deepEqual(
  mergeRosterAssignmentsWithFallback([{
    badge: strongPikemanBadge,
    best: strongVisualPikeman,
    alternatives: [strongVisualPikeman, weakerRosterHalberdier]
  }], conservativeAssignment, conservativeRoster).map((entry) => entry.label),
  ["strong-visual-pikeman"],
  "The unmatched visual stack must remain available while the hidden roster stack is recovered separately."
);

const aiCountBadge = { id: "ai-count-owner", count: 18 };
const wrongSideMechanic = {
  ...candidate("wrong-side-player-mechanic", "player", 172, 0.678),
  rawQuality: 0.85,
  badge: aiCountBadge,
  correlation: 0.4,
  chroma: 0.95
};
const correctSidePikeman = {
  ...candidate("count-supported-ai-pikeman", "ai", 0, 0.667),
  rawQuality: 0.669,
  badge: aiCountBadge,
  correlation: 0.31,
  chroma: 0.98
};
assert.deepEqual(
  mergeRosterAssignmentsWithFallback([{
    badge: aiCountBadge,
    best: wrongSideMechanic,
    alternatives: [wrongSideMechanic, correctSidePikeman]
  }], [], {
    entries: [{ owner: "ai", creatureId: null, count: 18 }],
    lowerBoundRoster: [{ owner: "player", creatureId: 172, count: 8, instances: 1 }]
  }).map((entry) => entry.label),
  ["count-supported-ai-pikeman"],
  "An unidentified queue card may still disambiguate the owner of a strong battlefield match by count."
);

const unknownIdentityBadge = { id: "unknown-count-identity", count: 18 };
const correctVisualRoyalGriffin = {
  ...candidate("correct-visual-ai-royal-griffin", "ai", 5, 0.68),
  rawQuality: 0.68,
  badge: unknownIdentityBadge,
  correlation: 0.31,
  chroma: 0.98
};
const accidentalPikemanFromNull = {
  ...candidate("accidental-pikeman-from-null", "ai", 0, 0.67),
  rawQuality: 0.67,
  badge: unknownIdentityBadge,
  correlation: 0.31,
  chroma: 0.98
};
assert.deepEqual(
  mergeRosterAssignmentsWithFallback([{
    badge: unknownIdentityBadge,
    best: correctVisualRoyalGriffin,
    alternatives: [correctVisualRoyalGriffin, accidentalPikemanFromNull]
  }], [], {
    entries: [{ owner: "ai", creatureId: null, count: 18 }],
    lowerBoundRoster: []
  }).map((entry) => entry.label),
  ["correct-visual-ai-royal-griffin"],
  "An unknown turn-bar identity must not be coerced from null into Pikeman creatureId 0."
);

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
  entries: [
    { owner: "player", creatureId: 172, count: 6 },
    { owner: "ai", creatureId: 178, count: 3 }
  ],
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

const sameOwnerFalseMonk = {
  ...candidate("false-ai-monk", "ai", 8, 0.72),
  badge: visuallyBiasedBadge,
  correlation: 0.45,
  chroma: 0.95,
  rawQuality: 0.77
};
const sameOwnerExactWorm = {
  ...candidate("exact-count-ai-worm", "ai", 178, 0.61),
  badge: visuallyBiasedBadge,
  correlation: 0.5,
  chroma: 0.95,
  rawQuality: 0.72
};
const sameOwnerCreatureCorrection = mergeRosterAssignmentsWithFallback([
  {
    badge: visuallyBiasedBadge,
    best: sameOwnerFalseMonk,
    alternatives: [sameOwnerFalseMonk, sameOwnerExactWorm]
  }
], [], {
  entries: [{ owner: "ai", creatureId: 178, count: 3 }],
  lowerBoundRoster: [{ owner: "ai", creatureId: 178, count: 3, instances: 1 }]
});
assert.deepEqual(
  sameOwnerCreatureCorrection.map((entry) => entry.label),
  ["exact-count-ai-worm"],
  "An exact turn-bar count identity must correct a same-owner false Monk match to Sandworm before the owner early return."
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

const rosterCreatures = [
  { creatureId: 176, name: "Automaton", stats: { hp: 30, shots: 0 } },
  { creatureId: 178, name: "Sandworm", stats: { hp: 50, shots: 0 } },
  { creatureId: 185, name: "Juggernaut", stats: { hp: 200, shots: 0 } }
];
const completedRosterStacks = [{
  owner: "player",
  creature: rosterCreatures[0],
  count: 1,
  armySlot: 0
}];
const completed = completeStacksFromTurnRoster(completedRosterStacks, {
  lowerBoundRoster: [
    { owner: "player", creatureId: 176, count: 1, instances: 1 },
    { owner: "player", creatureId: 178, count: 1, instances: 1 },
    { owner: "player", creatureId: 185, count: 1, instances: 1 }
  ]
}, {
  creatures: rosterCreatures,
  battlefield: { grid: { hexes: [{ id: 0, row: 5, col: 0 }] } }
});
assert.equal(completed, 2, "The turn bar must synthesize known stacks whose battlefield sprites or badges were occluded.");
assert.deepEqual(
  completedRosterStacks.map((stack) => `${stack.creature.name}:${stack.count}:${stack.armySlot}`),
  ["Automaton:1:0", "Sandworm:1:1", "Juggernaut:1:2"]
);

const correctedVisualStack = [{ owner: "ai", creature: rosterCreatures[1], count: 41, armySlot: 0 }];
assert.equal(completeStacksFromTurnRoster(correctedVisualStack, {
  lowerBoundRoster: [{ owner: "ai", creatureId: 178, count: 4, instances: 1 }]
}, {
  creatures: rosterCreatures,
  battlefield: { grid: { hexes: [{ id: 0, row: 5, col: 14 }] } }
}), 0, "A visually detected stack must be corrected from the turn bar, not duplicated.");
assert.equal(correctedVisualStack[0].count, 4);

console.log("Roster-constrained screenshot candidate assignment tests passed.");
