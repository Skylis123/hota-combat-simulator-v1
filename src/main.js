import { loadSimulatorData } from "./data/loader.js";
import { renderCreatureList } from "./components/CreatureList.js";
import { renderBattlefield } from "./components/Battlefield.js";
import { renderStackInfo } from "./components/StackInfo.js";
import { renderTurnOrder } from "./components/TurnOrderBar.js";
import { renderArmySetup } from "./components/ArmySetup.js";
import { animateAttackResult, animateStackAttack, animateStackDefend, animateStackMove } from "./components/BattleAnimator.js";
import { createBattleStack, createInitialState, resetBattle, setSetupStackCount, startBattle } from "./engine/battleState.js";
import { defendStack, moveStack, waitStack } from "./engine/actions.js";
import { attackOption, chooseBestAttack, executeAttack, performAiTurn } from "./engine/combat.js";
import { findMovementPath, reachableHexes } from "./engine/movement.js";
import { canStackOccupy, occupiedHexesForStacks } from "./engine/footprint.js";
import { chooseBestResurrection, executeResurrection, resurrectionCandidates } from "./engine/creatureAbilities.js";
import { deployAllArmies, stackInArmySlot } from "./engine/armyDeployment.js";

const elements = {
  dataStatus: document.querySelector("#data-status"),
  creatureList: document.querySelector("#creature-list"),
  battlefieldViewport: document.querySelector("#battlefield-viewport"),
  battlefield: document.querySelector("#battlefield"),
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

async function boot() {
  try {
    data = await loadSimulatorData();
    elements.dataStatus.textContent = "Loaded";
    elements.dataStatus.classList.add("ok");
    elements.battlefieldTitle.textContent = `${data.battlefield.name} · ${data.battlefield.grid.hexCount} visible hexes`;
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
    state = createInitialState();
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
      (result) => animateAttackResult(elements.battlefield, data.battlefield.grid, stack, best.target, result)
    );
  });

  elements.defendAction.addEventListener("click", async () => {
    const stack = activePlayerStack();
    if (!stack || battleAnimationPending) return;
    await runAnimatedAction(
      () => animateStackDefend(elements.battlefield, data.battlefield.grid, stack),
      () => defendStack(state, stack)
    );
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
  const scale = Math.min(window.innerWidth / 800, window.innerHeight / 556);
  elements.battlefield.style.transform = `scale(${scale})`;
}

function activePlayerStack() {
  const stack = state.stacks.find((candidate) => candidate.id === state.activeStackId);
  return stack?.owner === "player" ? stack : null;
}

function isHexOccupied(hexId, exceptStackId = null) {
  return occupiedHexesForStacks(data.battlefield.grid, state.stacks, exceptStackId).has(hexId);
}

function onSelectCreature(creatureId) {
  state.selectedCreatureId = creatureId;
  state.selectedStackId = null;
  render();
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
    if (!stack || !canStackOccupy(data.battlefield.grid, state.stacks, stack, hexId)) return;
    stack.hexId = hexId;
    state.selectedStackId = stack.id;
    state.selectedCreatureId = null;
    render();
  }
}

async function onHexClick(hexId) {
  if (state.phase === "setup") return;

  const active = activePlayerStack();
  if (state.phase === "battle" && active && !battleAnimationPending && state.reachable.has(hexId) && !isHexOccupied(hexId, active.id)) {
    const path = findMovementPath(data.battlefield.grid, state.stacks, active, hexId);
    if (!path) return;
    await runAnimatedAction(
      () => animateStackMove(elements.battlefield, data.battlefield.grid, active, path),
      () => moveStack(state, active, hexId)
    );
  }
}

async function onStackClick(stackId) {
  if (battleAnimationPending) return;
  const clicked = state.stacks.find((candidate) => candidate.id === stackId);
  const active = activePlayerStack();
  if (state.phase === "battle" && active && clicked && clicked.owner !== active.owner) {
    const option = attackOption(data.battlefield.grid, state, active, clicked);
    if (option.canAttack) {
      await runAnimatedAction(
        () => animateStackAttack(elements.battlefield, data.battlefield.grid, active, clicked, option),
        () => executeAttack(state, data.battlefield.grid, active, clicked, option),
        (result) => animateAttackResult(elements.battlefield, data.battlefield.grid, active, clicked, result)
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
      (result) => animateAttackResult(elements.battlefield, data.battlefield.grid, active, target, result)
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
  updateReachable();
  renderBattlefield(elements.battlefield, data, state, battlefieldHandlers());
}

function battlefieldHandlers() {
  return { onDrop, onHexClick, onStackClick, onStackHover };
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
  state.reachable = battlePreview ? reachableHexes(data.battlefield.grid, state.stacks, battlePreview) : new Set();
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
  const canStart = state.phase === "setup" && state.stacks.some((stack) => stack.owner === "player") && state.stacks.some((stack) => stack.owner === "ai");
  elements.startBattle.disabled = !canStart;
  elements.battleActions.classList.toggle("hidden", state.phase !== "battle" || !activePlayerStack());
  elements.attackBestAction.disabled = state.phase !== "battle" || !activePlayerStack() || state.attackableTargetIds.size === 0;
  const active = activePlayerStack();
  const resurrectionTargets = active ? resurrectionCandidates(state, active) : [];
  elements.resurrectAction.classList.toggle("hidden", resurrectionTargets.length === 0 && !active?.resurrectionUsed);
  elements.resurrectAction.disabled = resurrectionTargets.length === 0;
  elements.resurrectAction.textContent = active?.resurrectionUsed ? "Resurrection Used" : "Resurrect Ally";

  renderCreatureList(elements.creatureList, data, state, onSelectCreature);
  renderBattlefield(elements.battlefield, data, state, battlefieldHandlers());
  renderArmySetup(elements.armySetup, state, {
    onSlotClick: onArmySlotClick,
    onSlotDrop: onArmySlotDrop,
    onStackContextMenu: openStackCountEditor
  });
  renderStackInfo(elements.stackInfo, data, state);
  renderTurnOrder(elements.turnOrder, state);
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
          afterAttack: (attacker, target, result) => animateAttackResult(elements.battlefield, data.battlefield.grid, attacker, target, result),
          beforeMove: (stack, _hexId, path) => animateStackMove(elements.battlefield, data.battlefield.grid, stack, path),
          beforeDefend: (stack) => animateStackDefend(elements.battlefield, data.battlefield.grid, stack)
        }),
        () => {}
      );
    }
  }, 450);
}

boot();
