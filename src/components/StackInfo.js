import { abilityBadges, normalizeAbilityText } from "../engine/abilities.js";
import { resolveCreatureImage } from "../engine/assetResolver.js";

export function renderStackInfo(container, data, state) {
  const stack = state.stacks.find((candidate) => candidate.id === state.selectedStackId);
  const creature = stack?.creature || data.creatures.find((candidate) => candidate.creatureId === state.selectedCreatureId);
  if (!creature) {
    container.className = "stack-info empty";
    container.textContent = "Select a creature or a placed stack.";
    return;
  }

  const image = resolveCreatureImage(creature);
  const badges = abilityBadges(creature);
  const rawAbilities = normalizeAbilityText(creature);
  container.className = "stack-info";
  container.innerHTML = `
    <div class="info-heading">
      <img src="${image.src}" alt="${creature.name}" />
      <div>
        <h3>${creature.name}</h3>
        <p>${stack ? `${stack.owner.toUpperCase()} stack on hex ${stack.hexId}` : "Ready to place"}</p>
      </div>
    </div>
    <dl class="stats-grid">
      <div><dt>Attack</dt><dd>${creature.stats.attack ?? "-"}</dd></div>
      <div><dt>Defense</dt><dd>${creature.stats.defense ?? "-"}</dd></div>
      <div><dt>Damage</dt><dd>${creature.stats.minDamage ?? "-"}-${creature.stats.maxDamage ?? "-"}</dd></div>
      <div><dt>HP</dt><dd>${creature.stats.hp ?? "-"}</dd></div>
      <div><dt>Speed</dt><dd>${creature.stats.speed ?? "-"}</dd></div>
      <div><dt>Shots</dt><dd>${creature.stats.shots ?? 0}</dd></div>
    </dl>
    <div class="badge-row">${badges.map((badge) => `<span>${badge}</span>`).join("") || "<span>Passives unresolved</span>"}</div>
    ${stack ? renderStatuses(stack) : ""}
    ${stack && state.phase === "setup" ? renderSetupControls(stack) : ""}
    <details>
      <summary>Raw ability notes</summary>
      <p>${rawAbilities.join("; ") || "No extracted ability notes."}</p>
    </details>
  `;
}

function renderStatuses(stack) {
  const statuses = [];
  if (stack.statuses.acted) statuses.push("Acted");
  if (stack.statuses.waiting) statuses.push("Wait");
  if (stack.statuses.defending) statuses.push(`Defend +${stack.defenseBonus}`);
  return `<div class="status-line">${statuses.join(" · ") || "Ready"}</div>`;
}

function renderSetupControls(stack) {
  return `
    <div class="setup-stack-controls">
      <label class="field-label" for="selected-stack-count">Stack count</label>
      <input id="selected-stack-count" data-stack-count="${stack.id}" type="number" min="1" max="9999" value="${stack.count}" />
      <button type="button" data-delete-stack="${stack.id}">Delete Stack</button>
    </div>
  `;
}
