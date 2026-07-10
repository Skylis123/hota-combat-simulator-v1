import { loadSimulatorData } from "./data/loader.js";
import { renderCreatureList } from "./components/CreatureList.js";
import { renderBattlefield } from "./components/Battlefield.js";
import { renderStackInfo } from "./components/StackInfo.js";
import { renderTurnOrder } from "./components/TurnOrderBar.js";
import { createBattleStack, createInitialState, resetBattle, startBattle } from "./engine/battleState.js";
import { defendStack, moveStack, waitStack } from "./engine/actions.js";
import { attackOption, chooseBestAttack, executeAttack, performAiTurn } from "./engine/combat.js";
import { reachableHexes } from "./engine/movement.js";

const elements = {
  dataStatus: document.querySelector("#data-status"),
  creatureList: document.querySelector("#creature-list"),
  battlefield: document.querySelector("#battlefield"),
  stackInfo: document.querySelector("#stack-info"),
  turnOrder: document.querySelector("#turn-order"),
  ownerButtons: [...document.querySelectorAll(".segment")],
  stackCount: document.querySelector("#stack-count"),
  startBattle: document.querySelector("#start-battle"),
  resetBattle: document.querySelector("#reset-battle"),
  clearField: document.querySelector("#clear-field"),
  battleActions: document.querySelector("#battle-actions"),
  attackBestAction: document.querySelector("#attack-best-action"),
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
  elements.ownerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.owner = button.dataset.owner;
      elements.ownerButtons.forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    });
  });

  elements.stackCount.addEventListener("change", () => {
    state.stackCount = Math.max(1, Number(elements.stackCount.value || 1));
  });

  elements.startBattle.addEventListener("click", () => {
    if (state.stacks.length < 2) return;
    startBattle(state);
    updateReachable();
    render();
  });

  elements.resetBattle.addEventListener("click", () => {
    resetBattle(state);
    render();
  });

  elements.clearField.addEventListener("click", () => {
    state = createInitialState();
    elements.stackCount.value = String(state.stackCount);
    render();
  });

  elements.waitAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack) return;
    waitStack(state, stack);
    updateReachable();
    render();
  });

  elements.attackBestAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack) return;
    const best = chooseBestAttack(data.battlefield.grid, state, stack);
    if (!best) {
      state.actionLog.unshift(`${stack.label} has no attack target this turn.`);
      render();
      return;
    }
    executeAttack(state, data.battlefield.grid, stack, best.target, best.option);
    updateReachable();
    render();
  });

  elements.defendAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack) return;
    defendStack(state, stack);
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
    state.selectedStackId = null;
    render();
  });

  elements.stackInfo.addEventListener("change", (event) => {
    const input = event.target.closest("[data-stack-count]");
    if (!input || state.phase !== "setup") return;
    const stack = state.stacks.find((candidate) => candidate.id === input.dataset.stackCount);
    if (!stack) return;
    stack.count = Math.max(1, Number(input.value || 1));
    stack.hpTotal = stack.count * Number(stack.creature.stats.hp || 1);
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

function activePlayerStack() {
  const stack = state.stacks.find((candidate) => candidate.id === state.activeStackId);
  return stack?.owner === "player" ? stack : null;
}

function selectedCreature() {
  return data.creatures.find((creature) => creature.creatureId === state.selectedCreatureId);
}

function isHexOccupied(hexId, exceptStackId = null) {
  return state.stacks.some((stack) => stack.id !== exceptStackId && stack.hexId === hexId && stack.alive !== false);
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
    elements.battlefield.classList.toggle("drag-active", Boolean(hexFromClientPoint(event.clientX, event.clientY)));
  }
}

function onMenuDragEnd(event) {
  if (!menuDrag || event.pointerId !== menuDrag.pointerId) return;
  const drag = menuDrag;
  cleanupMenuDrag();

  if (drag.dragging) {
    const hex = hexFromClientPoint(event.clientX, event.clientY);
    if (hex) onDrop({ creatureId: drag.creatureId }, hex.id);
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
  elements.battlefield.classList.remove("drag-active");
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
  if (payload.stackId) {
    const stack = state.stacks.find((candidate) => candidate.id === payload.stackId);
    if (!stack || isHexOccupied(hexId, stack.id)) return;
    stack.hexId = hexId;
    state.selectedStackId = stack.id;
    state.selectedCreatureId = null;
    render();
    return;
  }

  const creatureId = payload.creatureId;
  if (state.phase !== "setup" || isHexOccupied(hexId)) return;
  const creature = data.creatures.find((candidate) => candidate.creatureId === creatureId);
  if (!creature) return;
  const stack = createBattleStack({
    creature,
    owner: state.owner,
    hexId,
    count: Math.max(1, Number(elements.stackCount.value || state.stackCount)),
    createdAt: createdAtCounter++
  });
  state.stacks.push(stack);
  state.selectedStackId = stack.id;
  state.selectedCreatureId = creature.creatureId;
  render();
}

function onHexClick(hexId) {
  if (state.phase === "setup") {
    if (state.selectedStackId) {
      onDrop({ stackId: state.selectedStackId }, hexId);
      return;
    }
    if (state.selectedCreatureId !== null) {
      onDrop({ creatureId: state.selectedCreatureId }, hexId);
      return;
    }
  }

  const active = activePlayerStack();
  if (state.phase === "battle" && active && state.reachable.has(hexId) && !isHexOccupied(hexId, active.id)) {
    moveStack(state, active, hexId);
    updateReachable();
    render();
  }
}

function onStackClick(stackId) {
  const clicked = state.stacks.find((candidate) => candidate.id === stackId);
  const active = activePlayerStack();
  if (state.phase === "battle" && active && clicked && clicked.owner !== active.owner) {
    const option = attackOption(data.battlefield.grid, state, active, clicked);
    if (option.canAttack) {
      executeAttack(state, data.battlefield.grid, active, clicked, option);
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

function onAttackSelectedTarget() {
  const active = activePlayerStack();
  const target = state.stacks.find((candidate) => candidate.id === state.selectedStackId);
  if (!active || !target || target.owner === active.owner) return;
  const option = attackOption(data.battlefield.grid, state, active, target);
  if (option.canAttack) {
    executeAttack(state, data.battlefield.grid, active, target, option);
  } else {
    state.actionLog.unshift(`${active.label} cannot reach ${target.label} this turn.`);
  }
  updateReachable();
  render();
}

function onStackHover(stackId) {
  state.hoveredStackId = stackId;
  updateReachable();
  renderBattlefield(elements.battlefield, data, state, battlefieldHandlers());
}

function battlefieldHandlers() {
  return { onDrop, onHexClick, onStackClick, onStackHover };
}

function hexFromClientPoint(clientX, clientY) {
  const grid = data.battlefield.grid;
  const rect = elements.battlefield.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  const x = ((clientX - rect.left) / rect.width) * grid.width;
  const y = ((clientY - rect.top) / rect.height) * grid.height;
  const containingHex = grid.hexes.find((hex) => pointInPolygon(x, y, hex.polygonPoints));
  if (containingHex) return containingHex;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const hex of grid.hexes) {
    const distance = Math.hypot(hex.centerX - x, hex.centerY - y);
    if (distance < nearestDistance) {
      nearest = hex;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= 28 ? nearest : null;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function updateReachable() {
  const active = state.stacks.find((stack) => stack.id === state.activeStackId);
  const hover = state.stacks.find((stack) => stack.id === state.hoveredStackId);
  const setupPreview = state.phase === "setup" ? hover : null;
  const battlePreview = state.phase === "battle" && active?.owner === "player" ? active : null;
  const previewStack = battlePreview || setupPreview;
  state.reachable = previewStack ? reachableHexes(data.battlefield.grid, state.stacks, previewStack) : new Set();
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

  renderCreatureList(elements.creatureList, data, state, onSelectCreature);
  renderBattlefield(elements.battlefield, data, state, battlefieldHandlers());
  renderStackInfo(elements.stackInfo, data, state);
  renderTurnOrder(elements.turnOrder, state);
  renderBattleLog();
  scheduleAiTurn();
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
  setTimeout(() => {
    aiTurnPending = false;
    const current = state.stacks.find((stack) => stack.id === state.activeStackId);
    if (state.phase === "battle" && current?.owner === "ai") {
      performAiTurn(state, data.battlefield.grid);
      updateReachable();
      render();
    }
  }, 450);
}

boot();
