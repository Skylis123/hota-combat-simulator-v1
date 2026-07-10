import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBattleStack, createInitialState, resetBattle, startBattle } from "../src/engine/battleState.js";
import { attackOption, attackOptions, chooseAdvanceOption, chooseBestAttack, executeAttack } from "../src/engine/combat.js";
import { findMovementPath } from "../src/engine/movement.js";
import { inferAbilityFlags } from "../src/engine/abilities.js";
import { calculateExpectedDamage, calculateRolledDamage } from "../src/engine/combatPower.js";
import { canStackOccupy, footprintHexes, placementPreview, stackVisualPosition } from "../src/engine/footprint.js";
import { executeResurrection } from "../src/engine/creatureAbilities.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "public", "data", "simulator-v1-data.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8").replace(/^\uFEFF/, ""));

const failures = [];
if (data.scope?.town !== "Castle") failures.push("V1 data is not Castle-scoped.");
if ((data.creatures || []).length !== 14) failures.push("Castle creature subset must contain 14 base/upgraded units.");
if (data.battlefield?.grid?.hexCount !== 165) failures.push("Visible grid must contain 165 hexes.");
if (!fs.existsSync(path.join(root, "public", data.battlefield.background.image))) failures.push("Battlefield background is missing.");

for (const creature of data.creatures || []) {
  const image = creature.asset?.displayImage;
  if (!image || !fs.existsSync(path.join(root, "public", image))) {
    failures.push(`Missing display image for creature ${creature.creatureId} ${creature.name}`);
  }
}

for (const creature of data.creatures) {
  const requiredAnimations = ["idle.gif", "move.gif", "hit.gif", "defend.gif", "death.gif", "corpse.png", "attack-up.gif", "attack-front.gif", "attack-down.gif"];
  if (inferAbilityFlags(creature).ranged) requiredAnimations.push("shoot-up.gif", "shoot-front.gif", "shoot-down.gif");
  for (const animation of requiredAnimations) {
    if (!fs.existsSync(path.join(root, "public", "assets", "creatures", "animations", String(creature.creatureId), animation))) {
      failures.push(`Missing ${creature.name} battle animation: ${animation}`);
    }
  }
}

const resetCreature = { name: "Reset test", stats: { hp: 30, shots: 12, speed: 5 } };
const resetState = createInitialState();
resetState.stacks = [
  createBattleStack({ creature: resetCreature, owner: "player", hexId: 12, count: 20, createdAt: 0 }),
  createBattleStack({ creature: resetCreature, owner: "ai", hexId: 99, count: 15, createdAt: 1 })
];
startBattle(resetState);
Object.assign(resetState.stacks[0], { hexId: 55, count: 3, hpTotal: 61, shotsRemaining: 2 });
Object.assign(resetState.stacks[1], { count: 0, hpTotal: 0, alive: false });
resetBattle(resetState);
if (
  resetState.stacks[0].hexId !== 12 ||
  resetState.stacks[0].count !== 20 ||
  resetState.stacks[0].hpTotal !== 600 ||
  resetState.stacks[0].shotsRemaining !== 12 ||
  resetState.stacks[1].count !== 15 ||
  resetState.stacks[1].alive !== true
) {
  failures.push("Reset Battle must restore starting positions and complete stack state.");
}

const pathGrid = {
  hexes: [
    { id: 0, neighbors: [1, 2] },
    { id: 1, neighbors: [0, 3] },
    { id: 2, neighbors: [0, 4] },
    { id: 3, neighbors: [1, 4] },
    { id: 4, neighbors: [2, 3] }
  ]
};
const pathCreature = { creatureId: 0, name: "Pikeman", stats: { hp: 10, speed: 4, shots: 0 } };
const mover = createBattleStack({ creature: pathCreature, owner: "player", hexId: 0, count: 20, createdAt: 0 });
const blocker = createBattleStack({ creature: pathCreature, owner: "player", hexId: 1, count: 20, createdAt: 1 });
const enemy = createBattleStack({ creature: pathCreature, owner: "ai", hexId: 3, count: 20, createdAt: 2 });
const detour = findMovementPath(pathGrid, [mover, blocker], mover, 3);
if (JSON.stringify(detour) !== JSON.stringify([0, 2, 4, 3])) {
  failures.push("Movement path must detour around occupied hexes.");
}
if (findMovementPath(pathGrid, [mover, blocker], mover, 1) !== null) {
  failures.push("Movement path must reject an occupied destination.");
}
const meleeRoute = attackOption(pathGrid, { stacks: [mover, blocker, enemy] }, mover, enemy);
if (!meleeRoute.canAttack || JSON.stringify(meleeRoute.approachPath) !== JSON.stringify([0, 2, 4])) {
  failures.push("Melee approach path must avoid occupied hexes.");
}
const slowAiCreature = { creatureId: 0, name: "Pikeman", stats: { hp: 10, speed: 1, shots: 0 } };
const aiMover = createBattleStack({ creature: slowAiCreature, owner: "ai", hexId: 0, count: 20, createdAt: 0 });
const aiBlocker = createBattleStack({ creature: pathCreature, owner: "ai", hexId: 1, count: 20, createdAt: 1 });
const playerTarget = createBattleStack({ creature: pathCreature, owner: "player", hexId: 3, count: 20, createdAt: 2 });
const aiAdvance = chooseAdvanceOption(pathGrid, { stacks: [aiMover, aiBlocker, playerTarget] }, aiMover);
if (aiAdvance.hexId !== 2 || JSON.stringify(aiAdvance.path) !== JSON.stringify([0, 2])) {
  failures.push("AI advance must follow the collision-free route around occupied hexes.");
}

const byCreatureId = new Map(data.creatures.map((creature) => [creature.creatureId, creature]));
const twoHexIds = data.creatures.filter((creature) => inferAbilityFlags(creature).twoHex).map((creature) => creature.creatureId);
if (JSON.stringify(twoHexIds) !== JSON.stringify([4, 5, 10, 11, 13])) {
  failures.push(`Castle two-hex mapping is incorrect: ${twoHexIds.join(", ")}`);
}
if (inferAbilityFlags(byCreatureId.get(4)).doubleAttack || inferAbilityFlags(byCreatureId.get(4)).retaliationLimit !== 2) {
  failures.push("Griffin must have two retaliations, not double attack.");
}
if (inferAbilityFlags(byCreatureId.get(5)).retaliationLimit !== Infinity) {
  failures.push("Royal Griffin must have unlimited retaliations.");
}

const footprintGrid = {
  hexes: [
    { id: 0, row: 0, col: 0, neighbors: [1] },
    { id: 1, row: 0, col: 1, neighbors: [0, 2] },
    { id: 2, row: 0, col: 2, neighbors: [1] }
  ]
};
const championStack = createBattleStack({ creature: byCreatureId.get(11), owner: "player", hexId: 1, count: 1, createdAt: 0 });
if (JSON.stringify(footprintHexes(footprintGrid, championStack)) !== JSON.stringify([1, 0])) {
  failures.push("Player two-hex footprint must occupy its primary and rear-left hex.");
}
if (canStackOccupy(footprintGrid, [], championStack, 0)) {
  failures.push("Two-hex stack must not fit at an edge without its rear hex.");
}
const championHoverPreview = placementPreview(footprintGrid, [], championStack, 1);
if (!championHoverPreview.valid || JSON.stringify(championHoverPreview.hexIds) !== JSON.stringify([1, 0])) {
  failures.push("Two-hex setup hover must preview both primary and rear hexes.");
}
const appCss = fs.readFileSync(path.join(root, "src", "styles", "app.css"), "utf8");
if (/\.battle-stack\.selected\s+img\s*\{[^}]*outline/s.test(appCss)) {
  failures.push("Selected stack styling must not draw a rectangular image outline.");
}

const joustingChampion = createBattleStack({ creature: byCreatureId.get(11), owner: "player", hexId: 76, count: 20, createdAt: 0 });
const playerChampionVisual = stackVisualPosition(data.battlefield.grid, joustingChampion);
const aiChampionVisual = stackVisualPosition(data.battlefield.grid, { ...joustingChampion, owner: "ai" });
if (playerChampionVisual?.centerX !== 132 || aiChampionVisual?.centerX !== 176) {
  failures.push(`Two-hex visual anchor mismatch: Player=${playerChampionVisual?.centerX}, AI=${aiChampionVisual?.centerX}.`);
}
const normalJoustTarget = createBattleStack({ creature: byCreatureId.get(6), owner: "ai", hexId: 84, count: 100, createdAt: 1 });
const joustingState = { stacks: [joustingChampion, normalJoustTarget] };
const joustingOptions = attackOptions(data.battlefield.grid, joustingState, joustingChampion, normalJoustTarget);
const selectedJoust = chooseBestAttack(data.battlefield.grid, joustingState, joustingChampion);
const maximumJoustSteps = Math.max(...joustingOptions.map((option) => option.approachPath.length - 1));
if (!selectedJoust || selectedJoust.option.approachPath.length - 1 !== maximumJoustSteps) {
  failures.push("Champion AI must jointly score target and approach hex to preserve the best Jousting bonus.");
}
const immuneJoustTarget = createBattleStack({ creature: byCreatureId.get(0), owner: "ai", hexId: 84, count: 100, createdAt: 1 });
const immuneJoustState = { stacks: [joustingChampion, immuneJoustTarget] };
const immuneOptions = attackOptions(data.battlefield.grid, immuneJoustState, joustingChampion, immuneJoustTarget);
const selectedImmuneJoust = chooseBestAttack(data.battlefield.grid, immuneJoustState, joustingChampion);
const minimumImmuneSteps = Math.min(...immuneOptions.map((option) => option.approachPath.length - 1));
if (!selectedImmuneJoust || selectedImmuneJoust.option.approachPath.length - 1 !== minimumImmuneSteps) {
  failures.push("Champion AI must prefer the shortest approach when the target is immune to Jousting.");
}

const damageCreature = (creatureId, damage = 100) => ({ creatureId, stats: { attack: 0, defense: 0, minDamage: damage, maxDamage: damage, hp: 100, speed: 9, shots: creatureId === 2 || creatureId === 9 ? 12 : 0 } });
const championDamage = calculateExpectedDamage(
  { creature: damageCreature(11), count: 1 },
  { creature: damageCreature(6), count: 1 },
  null,
  { mode: "melee", movementSteps: 3 }
).damage;
const immuneDamage = calculateExpectedDamage(
  { creature: damageCreature(11), count: 1 },
  { creature: damageCreature(0), count: 1 },
  null,
  { mode: "melee", movementSteps: 3 }
).damage;
if (championDamage !== 115 || immuneDamage !== 100) {
  failures.push(`Jousting damage mismatch: normal=${championDamage}, immune=${immuneDamage}.`);
}
const archerMelee = calculateExpectedDamage({ creature: damageCreature(2, 10), count: 1 }, { creature: damageCreature(6), count: 1 }, null, { mode: "melee" }).damage;
const zealotMelee = calculateExpectedDamage({ creature: damageCreature(9, 10), count: 1 }, { creature: damageCreature(6), count: 1 }, null, { mode: "melee" }).damage;
if (archerMelee !== 5 || zealotMelee !== 10) {
  failures.push(`Shooter melee penalty mismatch: Archer=${archerMelee}, Zealot=${zealotMelee}.`);
}
const variableArcher = { creature: { creatureId: 2, stats: { attack: 6, defense: 3, minDamage: 2, maxDamage: 3, hp: 10, speed: 4, shots: 12 } }, count: 20 };
const neutralDefender = { creature: { creatureId: 6, stats: { attack: 6, defense: 6, minDamage: 1, maxDamage: 1, hp: 100, speed: 5, shots: 0 } }, count: 20 };
const minimumRoll = calculateRolledDamage(variableArcher, neutralDefender, null, { mode: "ranged", rng: () => 0 }).damage;
const maximumRoll = calculateRolledDamage(variableArcher, neutralDefender, null, { mode: "ranged", rng: () => 0.999999 }).damage;
if (minimumRoll !== 40 || maximumRoll !== 60) {
  failures.push(`Runtime damage roll must span the full inclusive range: ${minimumRoll}..${maximumRoll}.`);
}
const longRangeMaximum = calculateRolledDamage(variableArcher, neutralDefender, null, { mode: "ranged", rangePenalty: 0.5, rng: () => 0.999999 }).damage;
if (longRangeMaximum !== 30) {
  failures.push(`Long-range damage penalty must halve ranged damage: ${longRangeMaximum}.`);
}

const archangel = createBattleStack({ creature: byCreatureId.get(13), owner: "player", hexId: 1, count: 2, createdAt: 0 });
const fallenAlly = createBattleStack({ creature: byCreatureId.get(6), owner: "player", hexId: 2, count: 50, createdAt: 1 });
fallenAlly.count = 0;
fallenAlly.hpTotal = 0;
fallenAlly.alive = false;
const resurrectionState = { stacks: [archangel, fallenAlly], actionLog: [], turnQueue: [archangel.id, fallenAlly.id], activeStackId: archangel.id, selectedStackId: archangel.id };
const resurrection = executeResurrection(resurrectionState, archangel, fallenAlly);
if (!resurrection.ok || resurrection.restoredHp !== 200 || fallenAlly.count !== 6 || !fallenAlly.alive || !archangel.resurrectionUsed) {
  failures.push("Archangel Resurrection must restore 100 HP per Archangel once per battle.");
}
if (executeResurrection(resurrectionState, archangel, fallenAlly).ok) {
  failures.push("Archangel Resurrection must be limited to one use per battle.");
}

const retaliationGrid = {
  hexes: [
    { id: 0, row: 0, col: 0, neighbors: [1] },
    { id: 1, row: 0, col: 1, neighbors: [0, 2] },
    { id: 2, row: 0, col: 2, neighbors: [1] }
  ]
};
const durableAttackerCreature = { creatureId: 6, name: "Swordsman", stats: { attack: 0, defense: 0, minDamage: 1, maxDamage: 1, hp: 1000, speed: 5, shots: 0 } };
const durableGriffinCreature = { creatureId: 4, name: "Griffin", stats: { attack: 0, defense: 0, minDamage: 1, maxDamage: 1, hp: 1000, speed: 6, shots: 0 } };
const retaliationAttacker = createBattleStack({ creature: durableAttackerCreature, owner: "player", hexId: 0, count: 1, createdAt: 0 });
const retaliationGriffin = createBattleStack({ creature: durableGriffinCreature, owner: "ai", hexId: 1, count: 1, createdAt: 1 });
const retaliationState = { phase: "battle", stacks: [retaliationAttacker, retaliationGriffin], actionLog: [], turnQueue: [retaliationAttacker.id, retaliationGriffin.id], activeStackId: retaliationAttacker.id, selectedStackId: retaliationAttacker.id, winner: null };
executeAttack(retaliationState, retaliationGrid, retaliationAttacker, retaliationGriffin);
retaliationAttacker.statuses.acted = false;
executeAttack(retaliationState, retaliationGrid, retaliationAttacker, retaliationGriffin);
retaliationAttacker.statuses.acted = false;
executeAttack(retaliationState, retaliationGrid, retaliationAttacker, retaliationGriffin);
if (retaliationGriffin.retaliationsUsed !== 2) {
  failures.push(`Griffin retaliation limit mismatch: ${retaliationGriffin.retaliationsUsed}.`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Simulator V1 data check passed.");
