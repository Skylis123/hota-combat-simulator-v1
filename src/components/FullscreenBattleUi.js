import { resolveCreatureImage } from "../engine/assetResolver.js";
import { computeTurnOrder, pendingTurnOrder } from "../engine/turnOrder.js";

export function renderFullscreenTurnOrder(container, state, handlers = {}) {
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
    item.dataset.turnStackId = stack.id;
    item.className = `fullscreen-turn-unit ${stack.owner} ${stack.id === state.activeStackId ? "active" : ""} ${stack.statuses.acted ? "acted" : ""}`;
    item.innerHTML = `
      <img src="${image.src}" alt="" />
      <span class="fullscreen-turn-count">${stack.count}</span>
      <span class="fullscreen-turn-speed">S${stack.creature.stats.speed ?? "-"}</span>
    `;
    item.title = `${stack.label} · speed ${stack.creature.stats.speed ?? "-"}`;
    item.addEventListener("mouseenter", () => handlers.onTurnHover?.(stack.id));
    item.addEventListener("mouseleave", () => handlers.onTurnHover?.(null));
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
  const statuses = [];
  if (stack.id === state.activeStackId) statuses.push("ACTIVE TURN");
  if (stack.statuses.waiting) statuses.push("WAITING");
  if (stack.statuses.defending) statuses.push(`DEFENDING +${stack.defenseBonus}`);
  if (stack.statuses.acted) statuses.push("ACTED");
  if (stack.statuses.retaliated) statuses.push("RETALIATED");
  if (stack.resurrectionUsed) statuses.push("RESURRECTION USED");
  for (const effect of stack.effects || []) statuses.push(String(effect.name || effect.type || "EFFECT").toUpperCase());

  container.innerHTML = `
    <div class="fullscreen-hover-heading">
      <img src="${image.src}" alt="" />
      <div><strong>${stack.label}</strong><span>${stack.owner.toUpperCase()} · army slot ${(stack.armySlot ?? 0) + 1}</span></div>
    </div>
    <div class="fullscreen-hover-stats">
      <span><small>Units</small><b>${stack.count}</b></span>
      <span><small>Total HP</small><b>${totalHp}</b></span>
      <span><small>Top HP</small><b>${topUnitHp}/${hpPerUnit}</b></span>
      <span><small>Attack</small><b>${stack.creature.stats.attack ?? "-"}</b></span>
      <span><small>Defense</small><b>${stack.creature.stats.defense ?? "-"}${stack.defenseBonus ? ` +${stack.defenseBonus}` : ""}</b></span>
      <span><small>Damage</small><b>${stack.creature.stats.minDamage ?? "-"}-${stack.creature.stats.maxDamage ?? "-"}</b></span>
      <span><small>Speed</small><b>${stack.creature.stats.speed ?? "-"}</b></span>
      <span><small>Shots</small><b>${stack.shotsRemaining ?? 0}/${stack.maxShots ?? 0}</b></span>
    </div>
    <div class="fullscreen-hover-statuses">${statuses.length ? statuses.map((status) => `<em>${status}</em>`).join("") : "<em>NO ACTIVE STATUS</em>"}</div>
  `;
  container.classList.add("visible");
}
