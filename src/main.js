import { loadSimulatorData } from "./data/loader.js";
import { renderCreatureList } from "./components/CreatureList.js";
import { renderTownSelector } from "./components/TownSelector.js";
import { renderBattlefield } from "./components/Battlefield.js";
import { renderStackInfo } from "./components/StackInfo.js";
import { renderTurnOrder } from "./components/TurnOrderBar.js";
import { renderArmySetup } from "./components/ArmySetup.js";
import { renderFullscreenHoverInfo, renderFullscreenTurnOrder } from "./components/FullscreenBattleUi.js";
import { animateAttackResult, animateStackAttack, animateStackMove } from "./components/BattleAnimator.js";
import { createBattleStack, createInitialState, resetBattle, setSetupStackCount, startBattle } from "./engine/battleState.js";
import { defendStack, moveStack, waitStack } from "./engine/actions.js";
import { attackOption, chooseBestAttack, executeAttack, performAiTurn } from "./engine/combat.js";
import { findMovementPath, reachableHexes } from "./engine/movement.js";
import { canStackOccupy, footprintHexes, movementPlacementForHex, occupiedHexesForStacks } from "./engine/footprint.js";
import {
  activateDetonation,
  activateTemporaryInvulnerability,
  chooseBestHeatStroke,
  chooseBestRepair,
  chooseBestResurrection,
  executeCorpseDevour,
  executeHeatStroke,
  executeRepair,
  executeResurrection,
  heatStrokeOptions,
  repairApproachOptions,
  repairCandidates,
  resurrectionCandidates
} from "./engine/creatureAbilities.js";
import { factoryAbilityFor } from "./engine/factoryAbilities.js";
import { ARMY_SLOT_COUNT, deployAllArmies, stackInArmySlot } from "./engine/armyDeployment.js";
import { selectPointerAttack } from "./engine/battleInteraction.js";
import { renderObstacleMenu } from "./components/ObstacleMenu.js";
import { renderBackgroundMenu } from "./components/BackgroundMenu.js";
import { allObstacleBlockedHexes, canPlaceObstacle, createObstacleInstance, generateObstacleLayout, manualObstaclePlacement } from "./engine/obstacles.js";
import { analyzeBattlefieldScreenshot } from "./engine/screenshotAnalyzer.js";
import { selectedTown, simulatorTowns } from "./engine/towns.js";

const elements = {
  dataStatus: document.querySelector("#data-status"),
  setupTitle: document.querySelector("#setup-title"),
  townList: document.querySelector("#town-list"),
  unitsTitle: document.querySelector("#units-title"),
  creatureList: document.querySelector("#creature-list"),
  obstacleMenu: document.querySelector("#obstacle-menu"),
  backgroundMenu: document.querySelector("#background-menu"),
  setupMenuTabs: document.querySelector("#setup-menu-tabs"),
  imageInput: document.querySelector("#battlefield-image-input"),
  importPreview: document.querySelector("#battlefield-import-preview"),
  analyzeImage: document.querySelector("#analyze-battlefield-image"),
  importStatus: document.querySelector("#battlefield-import-status"),
  battlefieldViewport: document.querySelector("#battlefield-viewport"),
  battlefield: document.querySelector("#battlefield"),
  fullscreenHoverInfo: document.querySelector("#fullscreen-hover-info"),
  fullscreenTurnOrder: document.querySelector("#fullscreen-turn-order"),
  stackInfo: document.querySelector("#stack-info"),
  turnOrder: document.querySelector("#turn-order"),
  armySetup: document.querySelector("#army-setup"),
  stackCountDialog: document.querySelector("#stack-count-dialog"),
  stackCountForm: document.querySelector("#stack-count-form"),
  stackCountEditor: document.querySelector("#stack-count-editor"),
  stackCountCreature: document.querySelector("#stack-count-creature"),
  stackCountMinus: document.querySelector("#stack-count-minus"),
  stackCountPlus: document.querySelector("#stack-count-plus"),
  stackCountCancel: document.querySelector("#stack-count-cancel"),
  stackCountClose: document.querySelector("#stack-count-close"),
  startBattle: document.querySelector("#start-battle"),
  resetBattle: document.querySelector("#reset-battle"),
  clearField: document.querySelector("#clear-field"),
  fullscreenBattlefield: document.querySelector("#fullscreen-battlefield"),
  battleActions: document.querySelector("#battle-actions"),
  attackBestAction: document.querySelector("#attack-best-action"),
  resurrectAction: document.querySelector("#resurrect-action"),
  repairAction: document.querySelector("#repair-action"),
  detonationAction: document.querySelector("#detonation-action"),
  invulnerabilityAction: document.querySelector("#invulnerability-action"),
  corpseDevourAction: document.querySelector("#corpse-devour-action"),
  heatStrokeAction: document.querySelector("#heat-stroke-action"),
  waitAction: document.querySelector("#wait-action"),
  defendAction: document.querySelector("#defend-action"),
  battleLog: document.querySelector("#battle-log"),
  battlefieldTitle: document.querySelector("#battlefield-title")
};

let data = null;
let state = createInitialState();
let createdAtCounter = 0;
let menuDrag = null;
let aiTurnPending = false;
let battleAnimationPending = false;
let editingStackId = null;
let importedImageFile = null;

async function boot() {
  try {
    data = await loadSimulatorData();
    const towns = simulatorTowns(data);
    if (!towns.some((town) => String(town.townType) === String(state.selectedTownType))) {
      state.selectedTownType = towns[0]?.townType ?? state.selectedTownType;
    }
    elements.dataStatus.textContent = "Loaded";
    elements.dataStatus.classList.add("ok");
    bindEvents();
    render();
  } catch (error) {
    elements.dataStatus.textContent = "Data error";
    elements.stackInfo.textContent = error.message;
    console.error(error);
  }
}

function bindEvents() {
  elements.fullscreenBattlefield.disabled = typeof elements.battlefieldViewport.requestFullscreen !== "function";
  elements.fullscreenBattlefield.addEventListener("click", toggleBattlefieldFullscreen);
  document.addEventListener("fullscreenchange", updateBattlefieldFullscreen);
  window.addEventListener("resize", updateBattlefieldFullscreen);
  document.addEventListener("keydown", onGlobalKeyDown);
  elements.setupMenuTabs.addEventListener("click", onSetupTabClick);
  elements.imageInput.addEventListener("change", () => loadImportedImage(elements.imageInput.files?.[0]));
  elements.analyzeImage.addEventListener("click", analyzeImportedImage);
  document.addEventListener("paste", onImagePaste);

  elements.startBattle.addEventListener("click", () => {
    if (state.stacks.length < 2 || battleAnimationPending) return;
    startBattle(state);
    updateReachable();
    render();
  });

  elements.resetBattle.addEventListener("click", () => {
    if (battleAnimationPending) return;
    resetBattle(state);
    render();
  });

  elements.clearField.addEventListener("click", () => {
    if (battleAnimationPending) return;
    state = createInitialState({ selectedTownType: state.selectedTownType });
    render();
  });

  elements.stackCountMinus.addEventListener("click", () => stepStackCount(-1));
  elements.stackCountPlus.addEventListener("click", () => stepStackCount(1));
  elements.stackCountCancel.addEventListener("click", closeStackCountEditor);
  elements.stackCountClose.addEventListener("click", closeStackCountEditor);
  elements.stackCountForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyStackCountEditor();
  });
  elements.stackCountDialog.addEventListener("close", () => {
    editingStackId = null;
  });

  elements.waitAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    waitStack(state, stack);
    updateReachable();
    render();
  });

  elements.attackBestAction.addEventListener("click", async () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    const best = chooseBestAttack(data.battlefield.grid, state, stack);
    if (!best) {
      state.actionLog.unshift(`${stack.label} has no attack target this turn.`);
      render();
      return;
    }
    await runAnimatedAction(
      () => animateStackAttack(elements.battlefield, data.battlefield.grid, stack, best.target, best.option),
      () => executeAttack(state, data.battlefield.grid, stack, best.target, best.option),
      (result) => animateAttackResult(elements.battlefield, data.battlefield.grid, stack, best.target, result, best.option)
    );
  });

  elements.defendAction.addEventListener("click", async () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    defendStack(state, stack);
    updateReachable();
    render();
  });

  elements.resurrectAction.addEventListener("click", () => {
    const archangel = activePlayerStack();
    if (!archangel || battleAnimationPending) return;
    const selected = state.stacks.find((stack) => stack.id === state.selectedStackId);
    const validTargets = resurrectionCandidates(state, archangel);
    const target = validTargets.find((candidate) => candidate.id === selected?.id) || chooseBestResurrection(state, archangel)?.target;
    if (!target) return;
    executeResurrection(state, archangel, target);
    updateReachable();
    render();
  });

  elements.repairAction.addEventListener("click", async () => {
    const repairer = activePlayerStack();
    if (!repairer || battleAnimationPending) return;
    const choice = selectedRepairChoice(repairer) || chooseBestRepair(state, repairer, data.battlefield.grid);
    if (!choice) return;
    await runAnimatedAction(
      () => choice.approachPath?.length > 1
        ? animateStackMove(elements.battlefield, data.battlefield.grid, repairer, choice.approachPath)
        : Promise.resolve(),
      () => executeRepair(state, repairer, choice.target, {
        grid: data.battlefield.grid,
        approachHex: choice.approachHex
      })
    );
  });

  elements.detonationAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    activateDetonation(state, stack);
    updateReachable();
    render();
  });

  elements.invulnerabilityAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    activateTemporaryInvulnerability(state, stack);
    updateReachable();
    render();
  });

  elements.corpseDevourAction.addEventListener("click", async () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    const choice = bestCorpseDevourChoice(stack);
    if (!choice) return;
    await runAnimatedAction(
      () => Promise.resolve(),
      () => executeCorpseDevour(state, data.battlefield.grid, stack, choice.destinationHexId)
    );
  });

  elements.heatStrokeAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    executeHeatStroke(state, data.battlefield.grid, stack);
    updateReachable();
    render();
  });

  elements.stackInfo.addEventListener("click", (event) => {
    const attackButton = event.target.closest("[data-attack-selected]");
    if (attackButton) {
      onAttackSelectedTarget();
      return;
    }

    const button = event.target.closest("[data-delete-stack]");
    if (!button || state.phase !== "setup") return;
    const stackId = button.dataset.deleteStack;
    state.stacks = state.stacks.filter((stack) => stack.id !== stackId);
    deployAllArmies(data.battlefield.grid, state.stacks);
    state.selectedStackId = null;
    render();
  });

  elements.creatureList.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".creature-card[data-creature-id]");
    if (!card || state.phase !== "setup" || event.button !== 0) return;
    cancelMenuDrag();
    menuDrag = {
      creatureId: Number(card.dataset.creatureId),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      ghost: null
    };
    document.addEventListener("pointermove", onMenuDragMove);
    document.addEventListener("pointerup", onMenuDragEnd);
    document.addEventListener("pointercancel", onMenuDragCancel);
  });

  window.addEventListener("blur", cancelMenuDrag);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelMenuDrag();
  });
}

function onGlobalKeyDown(event) {
  const editable = event.target instanceof HTMLElement && (
    event.target.matches("input, textarea, select") || event.target.isContentEditable
  );
  if (editable || elements.stackCountDialog.open) return;
  if (event.code === "Space") {
    event.preventDefault();
    toggleBattlefieldFullscreen();
    return;
  }
  if (state.phase !== "battle" || battleAnimationPending) return;
  if (event.key.toLowerCase() === "d") {
    event.preventDefault();
    elements.defendAction.click();
  } else if (event.key.toLowerCase() === "w") {
    event.preventDefault();
    elements.waitAction.click();
  }
}

async function toggleBattlefieldFullscreen() {
  try {
    if (document.fullscreenElement === elements.battlefieldViewport) {
      await document.exitFullscreen();
    } else {
      await elements.battlefieldViewport.requestFullscreen();
    }
  } catch (error) {
    state.actionLog.unshift(`Full screen could not be opened: ${error.message}`);
    renderBattleLog();
  }
}

function updateBattlefieldFullscreen() {
  const active = document.fullscreenElement === elements.battlefieldViewport;
  elements.fullscreenBattlefield.textContent = active ? "Exit Full Screen" : "Full Screen";
  if (!active) {
    elements.battlefield.style.transform = "";
    return;
  }
  const scale = Math.max(0.5, Math.min((window.innerWidth - 370) / 800, (window.innerHeight - 86) / 556));
  elements.battlefield.style.transform = `scale(${scale})`;
}

function activePlayerStack() {
  const stack = state.stacks.find((candidate) => candidate.id === state.activeStackId);
  return stack?.owner === "player" ? stack : null;
}

function selectedRepairChoice(repairer) {
  const selected = state.stacks.find((candidate) => candidate.id === state.selectedStackId);
  if (!selected || !repairCandidates(state, repairer).some((candidate) => candidate.id === selected.id)) return null;
  const approach = repairApproachOptions(data.battlefield.grid, state, repairer, selected).reduce((best, candidate) => (
    !best || candidate.approachPath.length < best.approachPath.length ? candidate : best
  ), null);
  return approach ? { target: selected, ...approach } : null;
}

function bestCorpseDevourChoice(stack) {
  const availableCorpses = (state.corpses || []).filter((corpse) => !corpse.consumed && !corpse.removed);
  if (!availableCorpses.length) return null;
  const selectedStackId = state.selectedStackId;
  let best = null;
  for (const corpse of availableCorpses) {
    const destinationHexId = (corpse.hexIds || [corpse.hexId])[0];
    const selectedPriority = corpse.stackId === selectedStackId ? 1 : 0;
    if (
      !best
      || selectedPriority > best.selectedPriority
      || (selectedPriority === best.selectedPriority && corpse.round > best.corpse.round)
    ) {
      best = { destinationHexId, corpse, selectedPriority };
    }
  }
  return best;
}

function selectedHeatStrokeChoice(stack) {
  const selected = state.stacks.find((candidate) => candidate.id === state.selectedStackId);
  if (!selected || selected.id === stack.id) return null;
  return heatStrokeOptions(data.battlefield.grid, state, stack)
    .filter((option) => option.targets.some((target) => target.id === selected.id))
    .reduce((best, option) => (
      !best
      || option.score > best.score
      || (option.score === best.score && option.targets.length > best.targets.length)
        ? option
        : best
    ), null);
}

function isHexOccupied(hexId, exceptStackId = null) {
  return occupiedHexesForStacks(data.battlefield.grid, state.stacks, exceptStackId).has(hexId);
}

function onSelectCreature(creatureId) {
  state.selectedCreatureId = creatureId;
  state.selectedStackId = null;
  render();
}

function onTownSelect(townType) {
  const town = simulatorTowns(data).find((candidate) => String(candidate.townType) === String(townType));
  if (!town) return;
  state.selectedTownType = townType;
  state.selectedCreatureId = null;
  if (state.phase === "setup") {
    if (town.battlefield && data.backgrounds.some((background) => background.id === town.battlefield)) {
      state.backgroundId = town.battlefield;
    }
    if (town.nativeTerrain) state.obstacleCategory = town.nativeTerrain;
  }
  render();
}

function onRosterOwnerSelect(owner) {
  if (state.phase !== "setup" || !["player", "ai"].includes(owner)) return;
  state.owner = owner;
  render();
}

function onRosterQuickAdd(creatureId) {
  if (state.phase !== "setup") return;
  const owner = state.owner === "ai" ? "ai" : "player";
  const freeSlot = Array.from({ length: ARMY_SLOT_COUNT }, (_, armySlot) => armySlot)
    .find((armySlot) => !stackInArmySlot(state.stacks, owner, armySlot));
  if (freeSlot === undefined) {
    state.actionLog.unshift(`${owner === "ai" ? "AI" : "Player"} army is full.`);
    renderBattleLog();
    return;
  }
  onArmySlotDrop({ creatureId }, owner, freeSlot);
}

function onMenuDragMove(event) {
  if (!menuDrag || event.pointerId !== menuDrag.pointerId) return;
  const distance = Math.hypot(event.clientX - menuDrag.startX, event.clientY - menuDrag.startY);
  if (!menuDrag.dragging && distance > 6) {
    menuDrag.dragging = true;
    state.selectedCreatureId = menuDrag.creatureId;
    state.selectedStackId = null;
    menuDrag.ghost = createDragGhost(menuDrag.creatureId);
    document.body.classList.add("menu-dragging");
  }
  if (menuDrag.dragging) {
    event.preventDefault();
    moveDragGhost(menuDrag.ghost, event.clientX, event.clientY);
    document.querySelectorAll(".army-slot.pointer-drop-target").forEach((slot) => slot.classList.remove("pointer-drop-target"));
    armySlotFromClientPoint(event.clientX, event.clientY)?.classList.add("pointer-drop-target");
  }
}

function onMenuDragEnd(event) {
  if (!menuDrag || event.pointerId !== menuDrag.pointerId) return;
  const drag = menuDrag;
  cleanupMenuDrag();

  if (drag.dragging) {
    const slot = armySlotFromClientPoint(event.clientX, event.clientY);
    if (slot) {
      onArmySlotDrop(
        { creatureId: drag.creatureId },
        slot.dataset.armyOwner,
        Number(slot.dataset.armySlot)
      );
    }
  } else {
    onSelectCreature(drag.creatureId);
  }
}

function onMenuDragCancel(event) {
  if (!menuDrag || event.pointerId !== menuDrag.pointerId) return;
  cancelMenuDrag();
}

function cancelMenuDrag() {
  if (!menuDrag && !document.querySelector(".drag-ghost")) return;
  cleanupMenuDrag();
}

function cleanupMenuDrag() {
  document.removeEventListener("pointermove", onMenuDragMove);
  document.removeEventListener("pointerup", onMenuDragEnd);
  document.removeEventListener("pointercancel", onMenuDragCancel);
  document.querySelectorAll(".army-slot.pointer-drop-target").forEach((slot) => slot.classList.remove("pointer-drop-target"));
  document.body.classList.remove("menu-dragging");
  document.querySelectorAll(".drag-ghost").forEach((ghost) => ghost.remove());
  menuDrag = null;
}

function createDragGhost(creatureId) {
  const creature = data.creatures.find((candidate) => candidate.creatureId === creatureId);
  const card = document.querySelector(`.creature-card[data-creature-id="${creatureId}"]`);
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.innerHTML = card?.innerHTML || creature?.name || "Stack";
  document.body.appendChild(ghost);
  return ghost;
}

function moveDragGhost(ghost, clientX, clientY) {
  if (!ghost) return;
  ghost.style.left = `${clientX + 14}px`;
  ghost.style.top = `${clientY + 14}px`;
}

function onDrop(payload, hexId) {
  if (state.phase !== "setup") return;
  state.setupPreview = null;
  if (payload.stackId) {
    const stack = state.stacks.find((candidate) => candidate.id === payload.stackId);
    if (!stack || !canStackOccupy(data.battlefield.grid, state.stacks, stack, hexId, state.obstacleBlockedHexIds)) return;
    stack.hexId = hexId;
    state.selectedStackId = stack.id;
    state.selectedCreatureId = null;
    render();
  }
}

async function onHexClick(hexId) {
  if (state.phase === "setup") {
    const definition = data.obstacles.find((obstacle) => obstacle.id === state.selectedObstacleId);
    if (!definition || definition.absolute) return;
    const placement = manualObstaclePlacement(data.battlefield.grid, state, definition, hexId);
    if (!placement) return;
    const instance = createObstacleInstance(data.battlefield.grid, definition, placement.anchorHexId);
    instance.manualCenterHexId = placement.clickedHexId;
    state.obstacles.push(instance);
    refreshObstacleBlocking();
    render();
    return;
  }

  const active = activePlayerStack();
  const movementPlacement = active ? movementPlacementForHex(data.battlefield.grid, active, state.reachable, hexId) : null;
  const destinationHexId = movementPlacement?.primaryHexId;
  if (state.phase === "battle" && active && !battleAnimationPending && destinationHexId !== undefined && !isHexOccupied(destinationHexId, active.id)) {
    const path = findMovementPath(data.battlefield.grid, state.stacks, active, destinationHexId, state.obstacleBlockedHexIds);
    if (!path) return;
    await runAnimatedAction(
      () => animateStackMove(elements.battlefield, data.battlefield.grid, active, path),
      () => moveStack(state, active, destinationHexId)
    );
  }
}

async function onStackClick(stackId) {
  if (battleAnimationPending) return;
  const clicked = state.stacks.find((candidate) => candidate.id === stackId);
  const active = activePlayerStack();
  if (state.phase === "battle" && active && clicked && clicked.owner !== active.owner) {
    const previewOption = state.attackPreview?.targetId === clicked.id ? state.attackPreview.option : null;
    const option = previewOption || attackOption(data.battlefield.grid, state, active, clicked);
    if (option.canAttack) {
      state.attackPreview = null;
      await runAnimatedAction(
        () => animateStackAttack(elements.battlefield, data.battlefield.grid, active, clicked, option),
        () => executeAttack(state, data.battlefield.grid, active, clicked, option),
        (result) => animateAttackResult(elements.battlefield, data.battlefield.grid, active, clicked, result, option)
      );
      return;
    } else {
      state.actionLog.unshift(`${active.label} cannot reach ${clicked.label}.`);
      state.selectedStackId = clicked.id;
    }
    updateReachable();
    render();
    return;
  }
  state.selectedStackId = stackId;
  state.selectedCreatureId = null;
  updateReachable();
  render();
}

async function onAttackSelectedTarget() {
  if (battleAnimationPending) return;
  const active = activePlayerStack();
  const target = state.stacks.find((candidate) => candidate.id === state.selectedStackId);
  if (!active || !target || target.owner === active.owner) return;
  const option = attackOption(data.battlefield.grid, state, active, target);
  if (option.canAttack) {
    await runAnimatedAction(
      () => animateStackAttack(elements.battlefield, data.battlefield.grid, active, target, option),
      () => executeAttack(state, data.battlefield.grid, active, target, option),
      (result) => animateAttackResult(elements.battlefield, data.battlefield.grid, active, target, result, option)
    );
    return;
  } else {
    state.actionLog.unshift(`${active.label} cannot reach ${target.label} this turn.`);
  }
  updateReachable();
  render();
}

function onStackHover(stackId) {
  if (battleAnimationPending) return;
  state.hoveredStackId = stackId;
  renderFullscreenHoverInfo(elements.fullscreenHoverInfo, state);
}

function onTurnOrderHover(stackId) {
  state.hoveredStackId = stackId;
  document.querySelectorAll("[data-turn-stack-id]").forEach((item) => {
    item.classList.toggle("turn-preview", item.dataset.turnStackId === stackId);
  });
  elements.battlefield.querySelectorAll(".battle-stack.turn-preview").forEach((item) => item.classList.remove("turn-preview"));
  elements.battlefield.querySelectorAll(".hex.turn-preview-hex").forEach((hex) => hex.classList.remove("turn-preview-hex"));
  const stack = state.stacks.find((candidate) => candidate.id === stackId);
  if (stack) {
    elements.battlefield.querySelector(`.battle-stack[data-stack-id="${stack.id}"]`)?.classList.add("turn-preview");
    for (const hexId of footprintHexes(data.battlefield.grid, stack) || []) {
      elements.battlefield.querySelector(`.hex[data-hex-id="${hexId}"]`)?.classList.add("turn-preview-hex");
    }
  }
  renderFullscreenHoverInfo(elements.fullscreenHoverInfo, state);
}

function onAttackHover(stackId, point = null, targetHexId = null) {
  if (!stackId || state.phase !== "battle" || battleAnimationPending) {
    state.attackPreview = null;
    return null;
  }
  const active = activePlayerStack();
  const target = state.stacks.find((stack) => stack.id === stackId);
  if (!active || !target || target.owner === active.owner || target.alive === false) {
    state.attackPreview = null;
    return null;
  }
  const preview = selectPointerAttack(data.battlefield.grid, state, active, target, point, targetHexId);
  if (!preview.option) {
    state.attackPreview = null;
    return preview;
  }
  state.attackPreview = { targetId: target.id, targetHexId: preview.targetHexId, option: preview.option };
  return preview;
}

function battlefieldHandlers() {
  return { onDrop, onHexClick, onStackClick, onStackHover, onAttackHover, onObstacleRemove };
}

function onSetupTabClick(event) {
  const button = event.target.closest("[data-setup-tab]");
  if (!button) return;
  document.querySelectorAll("[data-setup-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
  document.querySelectorAll("[data-setup-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.setupPanel === button.dataset.setupTab));
}

function onObstacleSelect(obstacleId) {
  if (state.phase !== "setup") return;
  const definition = data.obstacles.find((obstacle) => obstacle.id === obstacleId);
  if (!definition) return;
  if (definition.absolute) {
    if (!canPlaceObstacle(data.battlefield.grid, state, definition)) return;
    state.obstacles = state.obstacles.filter((obstacle) => !obstacle.absolute);
    state.obstacles.push(createObstacleInstance(data.battlefield.grid, definition));
    state.selectedObstacleId = null;
    refreshObstacleBlocking();
  } else {
    state.selectedObstacleId = state.selectedObstacleId === obstacleId ? null : obstacleId;
  }
  render();
}

function onObstacleRemove(instanceId) {
  if (state.phase !== "setup") return;
  state.obstacles = state.obstacles.filter((obstacle) => obstacle.instanceId !== instanceId);
  refreshObstacleBlocking();
  render();
}

function onBackgroundSelect(backgroundId) {
  if (state.phase !== "setup") return;
  state.backgroundId = backgroundId;
  const background = data.backgrounds.find((candidate) => candidate.id === backgroundId);
  if (background?.terrain) {
    state.obstacleCategory = background.terrain;
    render();
    return;
  }
  const aliases = {
    cmbkcf: "cursed_ground", cmbkef: "evil_fog", cmbkff: "fiery_fields", cmbkhg: "holy_ground",
    cmbklp: "lucid_pools", cmbkmag: "magic_clouds", cmbkmc: "magic_clouds", cmbkrk: "rocklands",
    wasteland_rocks: "wasteland"
  };
  if (aliases[backgroundId]) state.obstacleCategory = aliases[backgroundId];
  else if (backgroundId.includes("sn")) state.obstacleCategory = "snow";
  else if (backgroundId.includes("swmp")) state.obstacleCategory = "swamp";
  else if (backgroundId.includes("lava")) state.obstacleCategory = "lava";
  else if (backgroundId.includes("bch")) state.obstacleCategory = "sand_shore";
  else if (backgroundId.includes("boat") || backgroundId.includes("deck")) state.obstacleCategory = "ship";
  else if (backgroundId.includes("des")) state.obstacleCategory = "sand";
  else if (backgroundId.includes("rgh")) state.obstacleCategory = "rough";
  else if (backgroundId.includes("sub")) state.obstacleCategory = "subterra";
  else if (backgroundId.includes("dr")) state.obstacleCategory = "dirt";
  else state.obstacleCategory = "grass";
  render();
}

function refreshObstacleBlocking() {
  state.obstacleBlockedHexIds = allObstacleBlockedHexes(state);
}

function onImagePaste(event) {
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  if (!imageItem) return;
  event.preventDefault();
  loadImportedImage(imageItem.getAsFile());
  document.querySelector('[data-setup-tab="import"]')?.click();
}

function loadImportedImage(file) {
  if (!file?.type.startsWith("image/")) return;
  importedImageFile = file;
  const url = URL.createObjectURL(file);
  elements.importPreview.src = url;
  elements.importPreview.classList.add("visible");
  elements.analyzeImage.disabled = false;
  elements.importStatus.textContent = `${file.name || "Clipboard image"} loaded. Ready to analyze.`;
}

async function analyzeImportedImage() {
  if (!importedImageFile || state.phase !== "setup") return;
  elements.analyzeImage.disabled = true;
  elements.importStatus.textContent = "Analyzing background, obstacles and units...";
  try {
    const result = await analyzeBattlefieldScreenshot(importedImageFile, data);
    state.backgroundId = result.backgroundId || state.backgroundId;
    const detectedFactionCounts = new Map();
    for (const stack of result.stacks) {
      const faction = String(stack.creature?.faction || "").trim().toLowerCase();
      if (faction) detectedFactionCounts.set(faction, Number(detectedFactionCounts.get(faction) || 0) + 1);
    }
    const detectedFaction = [...detectedFactionCounts.entries()]
      .sort((left, right) => right[1] - left[1])[0]?.[0];
    const importedTown = simulatorTowns(data).find((town) => (
      (detectedFaction && String(town.name || "").trim().toLowerCase() === detectedFaction)
      || town.battlefield === result.backgroundId
    ));
    if (importedTown) {
      state.selectedTownType = importedTown.townType;
      if (importedTown.nativeTerrain) state.obstacleCategory = importedTown.nativeTerrain;
    }
    state.obstacles = result.obstacles;
    refreshObstacleBlocking();
    state.stacks = result.stacks;
    deployAllArmies(data.battlefield.grid, state.stacks);
    const cropNote = result.battleWindow?.detected
      ? " The Battlefield window was detected and cropped automatically before analysis."
      : "";
    elements.importStatus.textContent = `Applied ${result.obstacles.length} obstacles and ${result.stacks.length} unit candidates at their standard starting positions. Background: ${result.backgroundId}.${cropNote} ${result.note}`;
    render();
  } catch (error) {
    elements.importStatus.textContent = `Analysis failed: ${error.message}`;
  } finally {
    elements.analyzeImage.disabled = false;
  }
}

function armySlotFromClientPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  return element?.closest?.(".army-slot[data-army-owner][data-army-slot]") || null;
}

function onArmySlotClick(owner, armySlot, stackId) {
  if (state.phase !== "setup") return;
  if (stackId) {
    state.selectedStackId = stackId;
    state.selectedCreatureId = null;
    render();
    return;
  }
  const selectedStack = state.stacks.find((stack) => stack.id === state.selectedStackId);
  if (selectedStack) {
    onArmySlotDrop({ stackId: selectedStack.id }, owner, armySlot);
    return;
  }
  if (state.selectedCreatureId !== null) {
    onArmySlotDrop({ creatureId: state.selectedCreatureId }, owner, armySlot);
  }
}

function onArmySlotDrop(payload, owner, armySlot) {
  if (state.phase !== "setup" || !["player", "ai"].includes(owner)) return;
  const destination = stackInArmySlot(state.stacks, owner, armySlot);
  if (payload.stackId) {
    const stack = state.stacks.find((candidate) => candidate.id === payload.stackId);
    if (!stack || destination?.id === stack.id) return;
    const previousOwner = stack.owner;
    const previousSlot = stack.armySlot;
    if (destination) {
      destination.owner = previousOwner;
      destination.armySlot = previousSlot;
      updateStackOwnerLabel(destination);
    }
    stack.owner = owner;
    stack.armySlot = armySlot;
    updateStackOwnerLabel(stack);
    deployAllArmies(data.battlefield.grid, state.stacks);
    state.selectedStackId = stack.id;
    state.selectedCreatureId = null;
    render();
    return;
  }

  if (destination) return;
  const creature = data.creatures.find((candidate) => candidate.creatureId === payload.creatureId);
  if (!creature) return;
  const stack = createBattleStack({
    creature,
    owner,
    armySlot,
    hexId: 0,
    count: 1,
    createdAt: createdAtCounter++
  });
  state.stacks.push(stack);
  deployAllArmies(data.battlefield.grid, state.stacks);
  state.selectedStackId = stack.id;
  state.selectedCreatureId = null;
  render();
}

function updateStackOwnerLabel(stack) {
  stack.label = `${stack.owner === "ai" ? "AI" : "Player"} ${stack.creature.name}`;
}

function openStackCountEditor(stackId) {
  if (state.phase !== "setup") return;
  const stack = state.stacks.find((candidate) => candidate.id === stackId);
  if (!stack) return;
  editingStackId = stack.id;
  state.selectedStackId = stack.id;
  state.selectedCreatureId = null;
  elements.stackCountCreature.textContent = `${stack.owner === "ai" ? "AI" : "Player"} · ${stack.creature.name} · slot ${stack.armySlot + 1}`;
  elements.stackCountEditor.value = String(stack.count);
  elements.stackCountDialog.showModal();
  elements.stackCountEditor.focus();
  elements.stackCountEditor.select();
}

function closeStackCountEditor() {
  if (elements.stackCountDialog.open) elements.stackCountDialog.close();
  editingStackId = null;
}

function stepStackCount(delta) {
  const next = Math.max(1, Math.min(9999, Number(elements.stackCountEditor.value || 1) + delta));
  elements.stackCountEditor.value = String(next);
}

function applyStackCountEditor() {
  const stack = state.stacks.find((candidate) => candidate.id === editingStackId);
  if (!stack) {
    closeStackCountEditor();
    return;
  }
  setSetupStackCount(stack, elements.stackCountEditor.value);
  closeStackCountEditor();
  render();
}

function updateReachable() {
  const active = state.stacks.find((stack) => stack.id === state.activeStackId);
  const battlePreview = state.phase === "battle" && active?.owner === "player" ? active : null;
  state.reachable = battlePreview ? reachableHexes(data.battlefield.grid, state.stacks, battlePreview, state.obstacleBlockedHexIds) : new Set();
  state.enemyTargetIds = new Set();
  state.attackableTargetIds = new Set();
  if (state.phase === "battle" && active?.owner === "player") {
    for (const target of state.stacks) {
      if (target.owner === active.owner || target.alive === false || target.count <= 0) continue;
      state.enemyTargetIds.add(target.id);
      if (attackOption(data.battlefield.grid, state, active, target).canAttack) {
        state.attackableTargetIds.add(target.id);
      }
    }
  }
}

function render() {
  updateReachable();
  const town = selectedTown(data, state);
  const townName = town?.name || "Town";
  const background = data.backgrounds.find((candidate) => candidate.id === state.backgroundId);
  elements.setupTitle.textContent = `${townName} Combat Setup`;
  elements.unitsTitle.textContent = `${townName} Units`;
  elements.battlefieldTitle.textContent = `${background?.name || data.battlefield.name} · ${data.battlefield.grid.hexCount} visible hexes`;
  const canStart = state.phase === "setup" && state.stacks.some((stack) => stack.owner === "player") && state.stacks.some((stack) => stack.owner === "ai");
  elements.startBattle.disabled = !canStart;
  elements.battleActions.classList.toggle("hidden", state.phase !== "battle" || !activePlayerStack());
  elements.attackBestAction.disabled = state.phase !== "battle" || !activePlayerStack() || state.attackableTargetIds.size === 0;
  const active = activePlayerStack();
  elements.waitAction.disabled = !active || active.statuses.waiting;
  elements.defendAction.disabled = !active;
  const resurrectionTargets = active ? resurrectionCandidates(state, active) : [];
  elements.resurrectAction.classList.toggle("hidden", resurrectionTargets.length === 0 && !active?.resurrectionUsed);
  elements.resurrectAction.disabled = resurrectionTargets.length === 0;
  elements.resurrectAction.textContent = active?.resurrectionUsed ? "Resurrection Used" : "Resurrect Ally";
  const factoryAbility = active ? factoryAbilityFor(active) : null;
  const repairChoice = factoryAbility?.repair
    ? selectedRepairChoice(active) || chooseBestRepair(state, active, data.battlefield.grid)
    : null;
  elements.repairAction.classList.toggle("hidden", !factoryAbility?.repair);
  elements.repairAction.disabled = !repairChoice;
  elements.repairAction.textContent = Number(active?.repairUsesRemaining || 0) > 0 ? "Repair Ally" : "Repair Used";

  elements.detonationAction.classList.toggle("hidden", !factoryAbility?.detonation);
  elements.detonationAction.disabled = !factoryAbility?.detonation || Boolean(active?.detonationActive);
  elements.detonationAction.textContent = active?.detonationActive ? "Detonation Armed" : "Arm Detonation";

  elements.invulnerabilityAction.classList.toggle("hidden", !factoryAbility?.temporaryInvulnerability);
  elements.invulnerabilityAction.disabled = !factoryAbility?.temporaryInvulnerability
    || Number(active?.invulnerabilityUsesRemaining || 0) <= 0
    || Boolean(active?.invulnerable);
  elements.invulnerabilityAction.textContent = Number(active?.invulnerabilityUsesRemaining || 0) > 0
    ? "Meditation"
    : "Meditation Used";

  const corpseChoice = factoryAbility?.corpseDevour ? bestCorpseDevourChoice(active) : null;
  elements.corpseDevourAction.classList.toggle("hidden", !factoryAbility?.corpseDevour);
  elements.corpseDevourAction.disabled = !corpseChoice || Number(active?.corpseDevourUsesRemaining || 0) <= 0;
  elements.corpseDevourAction.textContent = Number(active?.corpseDevourUsesRemaining || 0) > 0 ? "Devour Corpse" : "Devour Used";

  elements.heatStrokeAction.classList.toggle("hidden", !factoryAbility?.heatStroke);
  elements.heatStrokeAction.disabled = !factoryAbility?.heatStroke
    || Boolean(active?.heatStrokeActive)
    || Number(active?.heatStrokeUsesRemaining || 0) <= 0;
  elements.heatStrokeAction.textContent = active?.heatStrokeActive
    ? "Heat Stroke Armed"
    : Number(active?.heatStrokeUsesRemaining || 0) > 0 ? "Heat Stroke" : "Heat Stroke Used";

  renderTownSelector(elements.townList, data, state, onTownSelect);
  renderCreatureList(elements.creatureList, data, state, {
    onSelect: onSelectCreature,
    onOwnerSelect: onRosterOwnerSelect,
    onQuickAdd: onRosterQuickAdd
  });
  renderObstacleMenu(elements.obstacleMenu, data, state, {
    onCategory: (category) => {
      state.obstacleCategory = category;
      render();
    },
    onSelect: onObstacleSelect,
    onAuto: () => {
      if (state.phase !== "setup") return;
      state.obstacles = generateObstacleLayout(data.battlefield.grid, state, data.obstacles, state.obstacleCategory);
      refreshObstacleBlocking();
      render();
    },
    onClear: () => {
      if (state.phase !== "setup") return;
      state.obstacles = [];
      refreshObstacleBlocking();
      render();
    }
  });
  renderBackgroundMenu(elements.backgroundMenu, data, state, onBackgroundSelect);
  renderBattlefield(elements.battlefield, data, state, battlefieldHandlers());
  renderArmySetup(elements.armySetup, state, {
    onSlotClick: onArmySlotClick,
    onSlotDrop: onArmySlotDrop,
    onStackContextMenu: openStackCountEditor
  });
  renderStackInfo(elements.stackInfo, data, state);
  renderTurnOrder(elements.turnOrder, state, { onTurnHover: onTurnOrderHover });
  renderFullscreenTurnOrder(elements.fullscreenTurnOrder, state, { onTurnHover: onTurnOrderHover });
  renderFullscreenHoverInfo(elements.fullscreenHoverInfo, state);
  renderBattleLog();
  scheduleAiTurn();
}

async function runAnimatedAction(animation, action, afterAction = null) {
  if (battleAnimationPending) return;
  battleAnimationPending = true;
  document.body.classList.add("battle-animation-running");
  try {
    await animation();
    const result = action();
    if (afterAction) await afterAction(result);
  } finally {
    battleAnimationPending = false;
    document.body.classList.remove("battle-animation-running");
    updateReachable();
    render();
  }
}

function renderBattleLog() {
  const entries = state.actionLog.slice(0, 10);
  elements.battleLog.innerHTML = entries.length
    ? entries.map((entry) => `<div>${entry}</div>`).join("")
    : `<span class="empty-turn">Battle events will appear here.</span>`;
}

function scheduleAiTurn() {
  const active = state.stacks.find((stack) => stack.id === state.activeStackId);
  if (aiTurnPending || state.phase !== "battle" || active?.owner !== "ai") return;
  aiTurnPending = true;
  setTimeout(async () => {
    aiTurnPending = false;
    const current = state.stacks.find((stack) => stack.id === state.activeStackId);
    if (state.phase === "battle" && current?.owner === "ai") {
      await runAnimatedAction(
        () => performAiTurn(state, data.battlefield.grid, {
          beforeAttack: (attacker, target, option) => animateStackAttack(elements.battlefield, data.battlefield.grid, attacker, target, option),
          afterAttack: (attacker, target, result, option) => animateAttackResult(elements.battlefield, data.battlefield.grid, attacker, target, result, option),
          beforeMove: (stack, _hexId, path) => animateStackMove(elements.battlefield, data.battlefield.grid, stack, path)
        }),
        () => {}
      );
    }
  }, 450);
}

boot();
