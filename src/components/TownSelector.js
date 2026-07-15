import { simulatorTowns } from "../engine/towns.js";

export function renderTownSelector(container, data, state, onSelect) {
  container.innerHTML = "";
  const towns = simulatorTowns(data);
  container.classList.toggle("single-town", towns.length < 2);
  container.setAttribute("aria-label", "Unit town");

  for (const town of towns) {
    const button = document.createElement("button");
    const selected = String(town.townType) === String(state.selectedTownType);
    button.type = "button";
    button.className = `town-option ${selected ? "active" : ""}`;
    button.dataset.townType = String(town.townType);
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = `<span>${town.name}</span>${town.origin ? `<small>${town.origin}</small>` : ""}`;
    button.addEventListener("click", () => onSelect(town.townType));
    container.appendChild(button);
  }
}
