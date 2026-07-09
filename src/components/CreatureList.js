import { abilityBadges } from "../engine/abilities.js";
import { resolveCreatureImage } from "../engine/assetResolver.js";

export function renderCreatureList(container, data, state, onSelect) {
  container.innerHTML = "";
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
      card.draggable = true;
      card.dataset.creatureId = String(creature.creatureId);

      const image = resolveCreatureImage(creature);
      card.innerHTML = `
        <img src="${image.src}" alt="${creature.name}" />
        <span class="creature-name">${creature.name}</span>
        <span class="creature-meta">A${creature.stats.attack ?? "-"} D${creature.stats.defense ?? "-"} S${creature.stats.speed ?? "-"}</span>
      `;
      card.title = abilityBadges(creature).join(", ") || "No confirmed passive tags";
      card.addEventListener("click", () => onSelect(creature.creatureId));
      card.addEventListener("dragstart", (event) => {
        onSelect(creature.creatureId);
        event.dataTransfer.setData("text/plain", String(creature.creatureId));
        event.dataTransfer.effectAllowed = "copy";
      });
      row.appendChild(card);
    }

    container.appendChild(row);
  }
}
