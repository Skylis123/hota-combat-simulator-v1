import { abilityBadges } from "../engine/abilities.js";
import { resolveCreatureImage } from "../engine/assetResolver.js";

export function renderCreatureList(container, data, state, handlers) {
  container.innerHTML = "";
  const ownerSelector = document.createElement("div");
  ownerSelector.className = "roster-owner-selector segmented";
  ownerSelector.setAttribute("aria-label", "Quick-add army owner");
  for (const owner of ["player", "ai"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `segment ${state.owner === owner ? "active" : ""}`;
    button.textContent = owner === "player" ? "Player" : "AI";
    button.setAttribute("aria-pressed", String(state.owner === owner));
    button.addEventListener("click", () => handlers.onOwnerSelect(owner));
    ownerSelector.appendChild(button);
  }
  const hint = document.createElement("small");
  hint.className = "roster-quick-add-hint";
  hint.textContent = "Right-click a unit to add it to the first free army slot.";
  container.append(ownerSelector, hint);
  const tiers = data.town.tiers || [];

  for (const tier of tiers) {
    const row = document.createElement("div");
    row.className = "tier-row";
    const tierLabel = document.createElement("div");
    tierLabel.className = "tier-label";
    tierLabel.textContent = `T${tier.tier}`;
    row.appendChild(tierLabel);

    for (const entry of [tier.base, tier.upgrade]) {
      const creature = data.creatures.find((candidate) => candidate.creatureId === entry.creatureId);
      if (!creature) continue;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `creature-card ${state.selectedCreatureId === creature.creatureId ? "selected" : ""}`;
      card.draggable = false;
      card.dataset.creatureId = String(creature.creatureId);

      const image = resolveCreatureImage(creature, "animation");
      card.innerHTML = `
        <img src="${image.src}" alt="${creature.name}" />
        <span class="creature-name">${creature.name}</span>
        <span class="creature-meta">A${creature.stats.attack ?? "-"} D${creature.stats.defense ?? "-"} S${creature.stats.speed ?? "-"}</span>
      `;
      card.title = abilityBadges(creature).join(", ") || "No confirmed passive tags";
      card.addEventListener("click", () => handlers.onSelect(creature.creatureId));
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        handlers.onQuickAdd(creature.creatureId);
      });
      row.appendChild(card);
    }

    container.appendChild(row);
  }
}
