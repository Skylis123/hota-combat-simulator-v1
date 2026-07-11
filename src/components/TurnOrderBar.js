import { pendingTurnOrder } from "../engine/turnOrder.js";

export function renderTurnOrder(container, state) {
  container.innerHTML = "";
  if (!state.stacks.length) {
    container.innerHTML = `<span class="empty-turn">Place stacks to preview turn order.</span>`;
    return;
  }

  const order = state.phase === "battle" ? pendingTurnOrder(state) : [...state.stacks]
    .sort((a, b) => (b.creature.stats.speed || 0) - (a.creature.stats.speed || 0))
    .map((stack) => stack.id);

  for (const stackId of order) {
    const stack = state.stacks.find((candidate) => candidate.id === stackId);
    if (!stack) continue;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `turn-pill ${stack.owner} ${stack.id === state.activeStackId ? "active" : ""} ${stack.statuses.acted ? "acted" : ""}`;
    pill.textContent = `${stack.creature.name} (${stack.creature.stats.speed ?? "-"})`;
    pill.title = `${stack.label} · hex ${stack.hexId}`;
    container.appendChild(pill);
  }
}
