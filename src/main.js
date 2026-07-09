import { loadSimulatorData } from "./data/loader.js";
import { renderCreatureList } from "./components/CreatureList.js";
import { renderBattlefield } from "./components/Battlefield.js";
import { renderStackInfo } from "./components/StackInfo.js";
import { renderTurnOrder } from "./components/TurnOrderBar.js";
import { createBattleStack, createInitialState, resetBattle, startBattle } from "./engine/battleState.js";
import { defendStack, moveStack, waitStack } from "./engine/actions.js";
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
  waitAction: document.querySelector("#wait-action"),
  defendAction: document.querySelector("#defend-action"),
  battlefieldTitle: document.querySelector("#battlefield-title")
};

let data = null;
let state = createInitialState();
let createdAtCounter = 0;

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

  elements.defendAction.addEventListener("click", () => {
    const stack = activePlayerStack();
    if (!stack) return;
    defendStack(state, stack);
    updateReachable();
    render();
  });

  elements.stackInfo.addEventListener("click", (event) => {
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
  const active = activePlayerStack();
  if (state.phase === "battle" && active && state.reachable.has(hexId) && !isHexOccupied(hexId, active.id)) {
    moveStack(state, active, hexId);
    updateReachable();
    render();
  }
}

function onStackClick(stackId) {
  state.selectedStackId = stackId;
  state.selectedCreatureId = null;
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

function updateReachable() {
  const active = state.stacks.find((stack) => stack.id === state.activeStackId);
  const hover = state.stacks.find((stack) => stack.id === state.hoveredStackId);
  const setupPreview = state.phase === "setup" ? hover : null;
  const battlePreview = state.phase === "battle" && active?.owner === "player" ? active : null;
  const previewStack = battlePreview || setupPreview;
  state.reachable = previewStack ? reachableHexes(data.battlefield.grid, state.stacks, previewStack) : new Set();
}

function render() {
  updateReachable();
  const canStart = state.phase === "setup" && state.stacks.some((stack) => stack.owner === "player") && state.stacks.some((stack) => stack.owner === "ai");
  elements.startBattle.disabled = !canStart;
  elements.battleActions.classList.toggle("hidden", !activePlayerStack());

  renderCreatureList(elements.creatureList, data, state, onSelectCreature);
  renderBattlefield(elements.battlefield, data, state, battlefieldHandlers());
  renderStackInfo(elements.stackInfo, data, state);
  renderTurnOrder(elements.turnOrder, state);
}

boot();
