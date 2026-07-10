import { resolveCreatureImage } from "../engine/assetResolver.js";
import { ARMY_SLOT_COUNT, stackInArmySlot } from "../engine/armyDeployment.js";

export function renderArmySetup(container, state, handlers) {
  container.innerHTML = "";
  for (const owner of ["player", "ai"]) {
    const panel = document.createElement("section");
    panel.className = `army-panel ${owner}`;
    panel.innerHTML = `
      <div class="army-heading">
        <span class="army-emblem" aria-hidden="true">${owner === "player" ? "⚔" : "♜"}</span>
        <div>
          <span class="section-title">${owner === "player" ? "Player Army" : "AI Army"}</span>
          <small>Army order 1–7</small>
        </div>
      </div>
    `;

    const slots = document.createElement("div");
    slots.className = "army-slots";
    const topRow = document.createElement("div");
    topRow.className = "army-row army-row-top";
    const bottomRow = document.createElement("div");
    bottomRow.className = "army-row army-row-bottom";

    for (let armySlot = 0; armySlot < ARMY_SLOT_COUNT; armySlot += 1) {
      const stack = stackInArmySlot(state.stacks, owner, armySlot);
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = `army-slot ${stack ? "occupied" : "empty"} ${stack?.id === state.selectedStackId ? "selected" : ""}`;
      slot.dataset.armyOwner = owner;
      slot.dataset.armySlot = String(armySlot);
      slot.title = stack ? `${stack.label} · army position ${armySlot + 1}` : `${owner === "player" ? "Player" : "AI"} army position ${armySlot + 1}`;
      if (stack) {
        const image = resolveCreatureImage(stack.creature, "animation");
        slot.innerHTML = `
          <span class="army-slot-number">${armySlot + 1}</span>
          <img src="${image.src}" alt="${stack.creature.name}" />
          <span class="army-stack-count">${stack.count}</span>
        `;
        slot.draggable = state.phase === "setup";
        slot.addEventListener("dragstart", (event) => {
          event.dataTransfer.setData("application/x-army-stack-id", stack.id);
          event.dataTransfer.effectAllowed = "move";
        });
      } else {
        slot.innerHTML = `<span class="army-slot-number">${armySlot + 1}</span><span class="army-slot-empty">+</span>`;
      }

      slot.addEventListener("click", () => handlers.onSlotClick(owner, armySlot, stack?.id || null));
      slot.addEventListener("dragover", (event) => {
        if (state.phase !== "setup") return;
        if (!event.dataTransfer.types.includes("application/x-army-stack-id")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        slot.classList.add("drop-target");
      });
      slot.addEventListener("dragleave", () => slot.classList.remove("drop-target"));
      slot.addEventListener("drop", (event) => {
        event.preventDefault();
        slot.classList.remove("drop-target");
        handlers.onSlotDrop({ stackId: event.dataTransfer.getData("application/x-army-stack-id") }, owner, armySlot);
      });
      (armySlot < 4 ? topRow : bottomRow).appendChild(slot);
    }

    slots.append(topRow, bottomRow);
    panel.appendChild(slots);
    container.appendChild(panel);
  }
}
