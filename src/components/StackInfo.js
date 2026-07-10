import { abilityBadges, normalizeAbilityText } from "../engine/abilities.js";
import { resolveCreatureImage } from "../engine/assetResolver.js";
import { calculateEffectiveStackPower, calculateThreatScore, calculateUnitValue } from "../engine/combatPower.js";

export function renderStackInfo(container, data, state) {
  const stack = state.stacks.find((candidate) => candidate.id === state.selectedStackId);
  const creature = stack?.creature || data.creatures.find((candidate) => candidate.creatureId === state.selectedCreatureId);
  if (!creature) {
    container.className = "stack-info empty";
    container.textContent = "Select a creature or a placed stack.";
    return;
  }

  const image = resolveCreatureImage(creature, "animation");
  const badges = abilityBadges(creature);
  const rawAbilities = normalizeAbilityText(creature);
  const evalStack = stack || {
    creature,
    count: Number(state.stackCount || 1),
    wound: 0,
    effects: [],
    defenseBonus: 0
  };
  const unitValue = calculateUnitValue(evalStack);
  const stackPower = calculateEffectiveStackPower(evalStack, state);
  const threat = calculateThreatScore(evalStack, state);
  const battleTarget = getSelectedBattleTargetState(state, stack);
  container.className = "stack-info";
  container.innerHTML = `
    <div class="info-heading">
      <img src="${image.src}" alt="${creature.name}" />
      <div>
        <h3>${creature.name}</h3>
        <p>${stack ? `${stack.owner.toUpperCase()} army slot ${(stack.armySlot ?? 0) + 1} · hex ${stack.hexId}` : "Choose a Player or AI army slot"}</p>
      </div>
    </div>
    <dl class="stats-grid">
      <div><dt>Attack</dt><dd>${creature.stats.attack ?? "-"}</dd></div>
      <div><dt>Defense</dt><dd>${creature.stats.defense ?? "-"}</dd></div>
      <div><dt>Damage</dt><dd>${creature.stats.minDamage ?? "-"}-${creature.stats.maxDamage ?? "-"}</dd></div>
      <div><dt>HP</dt><dd>${creature.stats.hp ?? "-"}</dd></div>
      <div><dt>Speed</dt><dd>${creature.stats.speed ?? "-"}</dd></div>
      <div><dt>Shots</dt><dd>${stack ? `${stack.shotsRemaining ?? 0}/${stack.maxShots ?? creature.stats.shots ?? 0}` : creature.stats.shots ?? 0}</dd></div>
      <div><dt>Stack HP</dt><dd>${stack ? Math.trunc(stack.hpTotal ?? 0) : "-"}</dd></div>
      <div><dt>Wound</dt><dd>${stack ? Math.trunc(stack.wound ?? 0) : "-"}</dd></div>
      <div><dt>Unit Value</dt><dd>${unitValue.rounded}</dd></div>
      <div><dt>Stack Power</dt><dd>${stackPower.rounded}</dd></div>
      <div><dt>Threat</dt><dd>${threat.rounded}</dd></div>
      <div><dt>Confidence</dt><dd>${stackPower.confidence}</dd></div>
    </dl>
    <p class="evaluation-note">Unit-only evaluation: count, HP/wound, effective Attack/Defense shape. Spellbook and buff/debuff AI scoring are not included in this phase.</p>
    <div class="badge-row">${badges.map((badge) => `<span>${badge}</span>`).join("") || "<span>Passives unresolved</span>"}</div>
    ${stack ? renderStatuses(stack) : ""}
    ${renderBattleTargetControls(battleTarget)}
    ${stack && state.phase === "setup" ? renderSetupControls(stack) : ""}
    <details>
      <summary>Raw ability notes</summary>
      <p>${rawAbilities.join("; ") || "No extracted ability notes."}</p>
    </details>
  `;
}

function getSelectedBattleTargetState(state, stack) {
  if (!stack || state.phase !== "battle") return null;
  const active = state.stacks.find((candidate) => candidate.id === state.activeStackId);
  if (!active || active.owner !== "player" || stack.owner === active.owner) return null;
  const canAttack = Boolean(state.attackableTargetIds?.has(stack.id));
  return {
    canAttack,
    message: canAttack
      ? "This enemy can be attacked now."
      : "This enemy is not reachable this turn."
  };
}

function renderBattleTargetControls(targetState) {
  if (!targetState) return "";
  return `
    <div class="target-action-panel ${targetState.canAttack ? "can-attack" : "cannot-attack"}">
      <p>${targetState.message}</p>
      <button type="button" data-attack-selected ${targetState.canAttack ? "" : "disabled"}>Attack selected target</button>
    </div>
  `;
}

function renderStatuses(stack) {
  const statuses = [];
  if (stack.statuses.acted) statuses.push("Acted");
  if (stack.statuses.waiting) statuses.push("Wait");
  if (stack.statuses.defending) statuses.push(`Defend +${stack.defenseBonus}`);
  if (stack.statuses.retaliated) statuses.push("Retaliated");
  return `<div class="status-line">${statuses.join(" / ") || "Ready"}</div>`;
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
