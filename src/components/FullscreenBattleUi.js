import { resolveCreatureImage } from "../engine/assetResolver.js";
import { computeTurnOrder, pendingTurnOrder } from "../engine/turnOrder.js";

export function renderFullscreenTurnOrder(container, state) {
  container.innerHTML = "";
  const order = state.phase === "battle" || state.phase === "finished"
    ? pendingTurnOrder(state)
    : computeTurnOrder(state.stacks);

  const strip = document.createElement("div");
  strip.className = "fullscreen-turn-strip";
  for (const stackId of order) {
    const stack = state.stacks.find((candidate) => candidate.id === stackId);
    if (!stack || stack.alive === false || stack.count <= 0) continue;
    const image = resolveCreatureImage(stack.creature, "preview");
    const item = document.createElement("div");
    item.className = `fullscreen-turn-unit ${stack.owner} ${stack.id === state.activeStackId ? "active" : ""} ${stack.statuses.acted ? "acted" : ""}`;
    item.innerHTML = `
      <img src="${image.src}" alt="" />
      <span class="fullscreen-turn-count">${stack.count}</span>
      <span class="fullscreen-turn-speed">S${stack.creature.stats.speed ?? "-"}</span>
    `;
    item.title = `${stack.label} · speed ${stack.creature.stats.speed ?? "-"}`;
    strip.appendChild(item);
  }

  const round = document.createElement("div");
  round.className = "fullscreen-round";
  round.innerHTML = `<strong>${state.round || 1}</strong><span>round</span>`;
  container.append(strip, round);
}

export function renderFullscreenHoverInfo(container, state) {
  const stack = state.stacks.find((candidate) => candidate.id === state.hoveredStackId);
  if (!stack) {
    container.innerHTML = "";
    container.classList.remove("visible");
    return;
  }
  const hpPerUnit = Math.max(1, Number(stack.creature.stats.hp || 1));
  const totalHp = Math.max(0, Number(stack.hpTotal ?? stack.count * hpPerUnit));
  const topUnitHp = stack.count > 0 ? Math.max(0, hpPerUnit - Number(stack.wound || 0)) : 0;
  const image = resolveCreatureImage(stack.creature, "preview");
  container.innerHTML = `
    <img src="${image.src}" alt="" />
    <div>
      <strong>${stack.label}</strong>
      <span>${stack.count} unit${stack.count === 1 ? "" : "s"} · ${totalHp} total HP</span>
      <span>Top unit HP ${topUnitHp}/${hpPerUnit} · A${stack.creature.stats.attack ?? "-"} D${stack.creature.stats.defense ?? "-"} S${stack.creature.stats.speed ?? "-"}</span>
      <span>${stack.shotsRemaining ?? 0}/${stack.maxShots ?? 0} shots${stack.statuses.defending ? ` · Defending +${stack.defenseBonus}` : ""}</span>
    </div>
  `;
  container.classList.add("visible");
}
