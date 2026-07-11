import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBattleStack, createInitialState, resetBattle, setSetupStackCount, startBattle } from "../src/engine/battleState.js";
import { attackOption, attackOptions, chooseAdvanceOption, chooseBestAttack, executeAttack } from "../src/engine/combat.js";
import { findMovementPath } from "../src/engine/movement.js";
import { inferAbilityFlags } from "../src/engine/abilities.js";
import { calculateExpectedDamage, calculateRolledDamage } from "../src/engine/combatPower.js";
import { canStackOccupy, footprintHexes, placementPreview, stackVisualPosition, stacksAreAdjacent } from "../src/engine/footprint.js";
import { executeResurrection } from "../src/engine/creatureAbilities.js";
import { computeTurnOrder, nextActiveStack, pendingTurnOrder } from "../src/engine/turnOrder.js";
import { deployAllArmies, deploymentRows } from "../src/engine/armyDeployment.js";
import { selectPointerAttack } from "../src/engine/battleInteraction.js";
import { waitStack } from "../src/engine/actions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "public", "data", "simulator-v1-data.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8").replace(/^\uFEFF/, ""));

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function gifDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  return [buffer.readUInt16LE(6), buffer.readUInt16LE(8)];
}

const failures = [];
if (createInitialState().stackCount !== 1) failures.push("New stacks must default to a count of one.");
if (data.scope?.town !== "Castle") failures.push("V1 data is not Castle-scoped.");
if ((data.creatures || []).length !== 14) failures.push("Castle creature subset must contain 14 base/upgraded units.");
if (data.battlefield?.grid?.hexCount !== 165) failures.push("Visible grid must contain 165 hexes.");
if (!fs.existsSync(path.join(root, "public", data.battlefield.background.image))) failures.push("Battlefield background is missing.");
const topHex = data.battlefield.grid.hexes.find((hex) => hex.row === 0 && hex.col === 0);
const lowerHex = data.battlefield.grid.hexes.find((hex) => hex.row === 1 && hex.col === 0);
if (
  Math.min(...topHex.polygonPoints.map((point) => point[1])) !== topHex.centerY - 28 ||
  !topHex.polygonPoints.some((point) => point[0] === lowerHex.centerX && point[1] === lowerHex.centerY - 28) ||
  !lowerHex.polygonPoints.some((point) => point[0] === topHex.centerX && point[1] === topHex.centerY + 28)
) {
  failures.push("Battlefield hex polygons must share exact game-style edges without vertical gaps.");
}
if (JSON.stringify(topHex.neighbors) !== JSON.stringify([1, 15, 16])) {
  failures.push(`Top-left battlefield corner must expose three contact hexes with game parity: ${topHex.neighbors}`);
}

for (const cursor of [
  "00-prohibited.png", "01-move.png", "02-fly.png", "03-shoot.png", "06-default.png",
  "07-attack-up-right.png", "08-attack-right.png", "09-attack-down-right.png",
  "10-attack-up-left.png", "11-attack-left.png", "12-attack-down-left.png", "13-attack-up.png", "14-attack-down.png"
]) {
  if (!fs.existsSync(path.join(root, "public", "assets", "cursors", "combat", cursor))) {
    failures.push(`Missing extracted Heroes III combat cursor: ${cursor}`);
  }
}

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
  const animationRoot = path.join(root, "public", "assets", "creatures", "animations", String(creature.creatureId));
  const corpseSize = pngDimensions(path.join(animationRoot, "corpse.png"));
  const deathSize = gifDimensions(path.join(animationRoot, "death.gif"));
  if (JSON.stringify(corpseSize) !== JSON.stringify(deathSize)) {
    failures.push(`${creature.name} corpse must retain the shared death canvas instead of being enlarged from a tight crop.`);
  }
}

const resetCreature = { name: "Reset test", stats: { hp: 30, shots: 12, speed: 5 } };
const countEditorStack = createBattleStack({ creature: resetCreature, owner: "player", hexId: 0, count: 1, createdAt: 0 });
setSetupStackCount(countEditorStack, 27);
if (countEditorStack.count !== 27 || countEditorStack.initialCount !== 27 || countEditorStack.hpTotal !== 810) {
  failures.push("Stack count editing must synchronize count, initial count and total HP.");
}
setSetupStackCount(countEditorStack, 0);
if (countEditorStack.count !== 1) failures.push("Stack count editing must clamp the minimum to one.");
const fastWaiter = createBattleStack({ creature: { name: "Fast", stats: { hp: 10, speed: 9 } }, owner: "player", hexId: 0, count: 1, createdAt: 0, armySlot: 0 });
const slowWaiter = createBattleStack({ creature: { name: "Slow", stats: { hp: 10, speed: 4 } }, owner: "player", hexId: 1, count: 1, createdAt: 1, armySlot: 1 });
const waitState = {
  stacks: [fastWaiter, slowWaiter],
  turnQueue: computeTurnOrder([fastWaiter, slowWaiter]),
  activeStackId: fastWaiter.id,
  actionLog: [],
  round: 1
};
if (!waitStack(waitState, fastWaiter) || waitState.activeStackId !== slowWaiter.id) {
  failures.push("Wait must defer the current stack behind all non-waiting stacks.");
}
waitStack(waitState, slowWaiter);
if (JSON.stringify(pendingTurnOrder(waitState)) !== JSON.stringify([slowWaiter.id, fastWaiter.id])) {
  failures.push("Wait phase must run in reverse initiative order, slowest waiting stack first.");
}
if (waitStack(waitState, slowWaiter)) {
  failures.push("A stack must not be allowed to Wait more than once in the same round.");
}
slowWaiter.statuses.acted = true;
if (nextActiveStack(waitState) !== fastWaiter.id) {
  failures.push("After the slow waiting stack acts, the next waiting stack must receive its delayed turn.");
}
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
if (JSON.stringify(deploymentRows(7)) !== JSON.stringify([0, 2, 4, 5, 6, 8, 10])) {
  failures.push("Seven-stack deployment rows must preserve the classic top-to-bottom formation.");
}
if (JSON.stringify(deploymentRows(4)) !== JSON.stringify([0, 4, 6, 10])) {
  failures.push("Four-stack deployment must match the classic loose formation.");
}
const armyOrderStacks = [
  createBattleStack({ creature: byCreatureId.get(0), owner: "player", armySlot: 2, hexId: 0, count: 10, createdAt: 0 }),
  createBattleStack({ creature: byCreatureId.get(0), owner: "player", armySlot: 0, hexId: 0, count: 10, createdAt: 2 }),
  createBattleStack({ creature: byCreatureId.get(0), owner: "player", armySlot: 1, hexId: 0, count: 10, createdAt: 1 })
];
deployAllArmies(data.battlefield.grid, armyOrderStacks);
const deployedCoordinates = armyOrderStacks
  .sort((first, second) => first.armySlot - second.armySlot)
  .map((stack) => {
    const hex = data.battlefield.grid.hexes.find((candidate) => candidate.id === stack.hexId);
    return [hex.row, hex.col];
  });
if (JSON.stringify(deployedCoordinates) !== JSON.stringify([[2, 0], [5, 0], [8, 0]])) {
  failures.push(`Player army slots must deploy top-to-bottom on the predefined flank: ${JSON.stringify(deployedCoordinates)}`);
}
const wideDeploymentStacks = [
  createBattleStack({ creature: byCreatureId.get(11), owner: "player", armySlot: 0, hexId: 0, count: 1, createdAt: 0 }),
  createBattleStack({ creature: byCreatureId.get(11), owner: "ai", armySlot: 0, hexId: 0, count: 1, createdAt: 1 })
];
deployAllArmies(data.battlefield.grid, wideDeploymentStacks);
const wideCoordinates = wideDeploymentStacks.map((stack) => {
  const hex = data.battlefield.grid.hexes.find((candidate) => candidate.id === stack.hexId);
  return [hex.row, hex.col];
});
if (JSON.stringify(wideCoordinates) !== JSON.stringify([[5, 1], [5, 13]])) {
  failures.push(`Two-hex stacks must shift inward while retaining the outer rear hex: ${JSON.stringify(wideCoordinates)}`);
}
const equalSpeedOrder = computeTurnOrder(armyOrderStacks);
const expectedArmyOrder = armyOrderStacks
  .slice()
  .sort((first, second) => first.armySlot - second.armySlot)
  .map((stack) => stack.id);
if (JSON.stringify(equalSpeedOrder) !== JSON.stringify(expectedArmyOrder)) {
  failures.push("Equal-speed stacks from the same army must act in army-slot order.");
}
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
const animatorSource = fs.readFileSync(path.join(root, "src", "components", "BattleAnimator.js"), "utf8");
if (!animatorSource.includes("syncStackElement(container, grid, attacker)")) {
  failures.push("Move-attack animation must synchronize the attacker's DOM position before retaliation.");
}
const creatureListSource = fs.readFileSync(path.join(root, "src", "components", "CreatureList.js"), "utf8");
if (!creatureListSource.includes('resolveCreatureImage(creature, "animation")')) {
  failures.push("Castle roster cards must use the sanitized idle animation.");
}
const battlefieldSource = fs.readFileSync(path.join(root, "src", "components", "Battlefield.js"), "utf8");
if (battlefieldSource.includes("application/x-creature-id")) {
  failures.push("The battlefield must not accept creatures directly from the roster.");
}
const armySetupSource = fs.readFileSync(path.join(root, "src", "components", "ArmySetup.js"), "utf8");
if (!armySetupSource.includes("armySlot < 3") || !armySetupSource.includes('addEventListener("contextmenu"')) {
  failures.push("Army setup must render 3+4 slots and expose the right-click stack editor.");
}
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (indexSource.includes('id="stack-count"') || !indexSource.includes('id="stack-count-dialog"')) {
  failures.push("The legacy global count field must be replaced by the stack count dialog.");
}
const mainSource = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
if (!indexSource.includes('id="fullscreen-battlefield"') || !mainSource.includes("requestFullscreen") || !mainSource.includes('addEventListener("fullscreenchange"')) {
  failures.push("Battlefield full screen must use the native Fullscreen API and react to ESC-driven fullscreen changes.");
}
if (!mainSource.includes('event.code === "Space"') || !mainSource.includes('event.key.toLowerCase() === "d"') || !mainSource.includes('event.key.toLowerCase() === "w"')) {
  failures.push("Battlefield hotkeys must include Space full screen, D defend and W wait.");
}
if (!battlefieldSource.includes("pointerHex") || !battlefieldSource.includes("onAttackHover")) {
  failures.push("Battlefield interaction must resolve overlapped sprite clicks by underlying hex and support direct attack hover.");
}
const fullscreenUiSource = fs.readFileSync(path.join(root, "src", "components", "FullscreenBattleUi.js"), "utf8");
if (!fullscreenUiSource.includes("total HP") || !fullscreenUiSource.includes("fullscreen-turn-unit")) {
  failures.push("Full screen must include unit HP hover details and a visual turn-order strip.");
}
const stackInfoSource = fs.readFileSync(path.join(root, "src", "components", "StackInfo.js"), "utf8");
if (stackInfoSource.includes("data-stack-count")) {
  failures.push("Selection details must not expose the legacy inline count field.");
}

const joustingChampion = createBattleStack({ creature: byCreatureId.get(11), owner: "player", hexId: 76, count: 20, createdAt: 0 });
const playerChampionVisual = stackVisualPosition(data.battlefield.grid, joustingChampion);
const aiChampionVisual = stackVisualPosition(data.battlefield.grid, { ...joustingChampion, owner: "ai" });
if (playerChampionVisual?.centerX !== 110 || aiChampionVisual?.centerX !== 154) {
  failures.push(`Two-hex visual anchor mismatch: Player=${playerChampionVisual?.centerX}, AI=${aiChampionVisual?.centerX}.`);
}
const parityGriffin = createBattleStack({ creature: byCreatureId.get(4), owner: "player", hexId: 31, count: 10, createdAt: 0 });
const diagonalEnemy = createBattleStack({ creature: byCreatureId.get(6), owner: "ai", hexId: 17, count: 10, createdAt: 1 });
const wideDiagonalEnemy = createBattleStack({ creature: byCreatureId.get(10), owner: "ai", hexId: 16, count: 10, createdAt: 2 });
for (const target of [diagonalEnemy, wideDiagonalEnemy]) {
  const parityState = { stacks: [parityGriffin, target] };
  const options = attackOptions(data.battlefield.grid, parityState, parityGriffin, target);
  if (!stacksAreAdjacent(data.battlefield.grid, parityGriffin, target) || !options.some((option) => option.approachHex === parityGriffin.hexId)) {
    failures.push(`Two-hex Griffin must attack an adjacent ${target.creature.name} from either occupied footprint cell.`);
  }
}
const normalJoustTarget = createBattleStack({ creature: byCreatureId.get(6), owner: "ai", hexId: 84, count: 100, createdAt: 1 });
const joustingState = { stacks: [joustingChampion, normalJoustTarget] };
const joustingOptions = attackOptions(data.battlefield.grid, joustingState, joustingChampion, normalJoustTarget);
const selectedJoust = chooseBestAttack(data.battlefield.grid, joustingState, joustingChampion);
const maximumJoustSteps = Math.max(...joustingOptions.map((option) => option.approachPath.length - 1));
if (!selectedJoust || selectedJoust.option.approachPath.length - 1 !== maximumJoustSteps) {
  failures.push("Champion AI must jointly score target and approach hex to preserve the best Jousting bonus.");
}
const pointerCandidate = joustingOptions[0];
const pointerPosition = stackVisualPosition(data.battlefield.grid, joustingChampion, pointerCandidate.approachHex);
const pointerAttack = selectPointerAttack(data.battlefield.grid, joustingState, joustingChampion, normalJoustTarget, {
  x: pointerPosition.centerX,
  y: pointerPosition.centerY
});
if (!pointerAttack.option || pointerAttack.approachHex !== pointerCandidate.approachHex || pointerAttack.cursor !== "attack-up-left") {
  failures.push("Enemy pointer sector must select its corresponding legal contact hex and sword cursor.");
}
const immuneJoustTarget = createBattleStack({ creature: byCreatureId.get(0), owner: "ai", hexId: 84, count: 100, createdAt: 1 });
const immuneJoustState = { stacks: [joustingChampion, immuneJoustTarget] };
const immuneOptions = attackOptions(data.battlefield.grid, immuneJoustState, joustingChampion, immuneJoustTarget);
const selectedImmuneJoust = chooseBestAttack(data.battlefield.grid, immuneJoustState, joustingChampion);
const minimumImmuneSteps = Math.min(...immuneOptions.map((option) => option.approachPath.length - 1));
if (!selectedImmuneJoust || selectedImmuneJoust.option.approachPath.length - 1 !== minimumImmuneSteps) {
  failures.push("Champion AI must prefer the shortest approach when the target is immune to Jousting.");
}
const adjacentNormalTarget = createBattleStack({ creature: byCreatureId.get(6), owner: "ai", hexId: 77, count: 100, createdAt: 1 });
const adjacentNormalState = { stacks: [joustingChampion, adjacentNormalTarget] };
const adjacentJoust = chooseBestAttack(data.battlefield.grid, adjacentNormalState, joustingChampion);
if (!adjacentJoust || adjacentJoust.option.approachPath.length <= 1) {
  failures.push("An adjacent Champion must consider moving to a better legal Jousting approach hex.");
}
const adjacentImmuneTarget = createBattleStack({ creature: byCreatureId.get(0), owner: "ai", hexId: 77, count: 100, createdAt: 1 });
const adjacentImmuneState = { stacks: [joustingChampion, adjacentImmuneTarget] };
const adjacentImmuneJoust = chooseBestAttack(data.battlefield.grid, adjacentImmuneState, joustingChampion);
if (!adjacentImmuneJoust || adjacentImmuneJoust.option.approachPath.length !== 1) {
  failures.push("An adjacent Champion must stay in place when Jousting is suppressed by immunity.");
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
