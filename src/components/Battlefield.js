import { resolveBackground, resolveCreatureImage } from "../engine/assetResolver.js";
import { polygonPointsToString } from "../engine/hexGrid.js";

export function renderBattlefield(container, data, state, handlers) {
  const battlefield = data.battlefield;
  const grid = battlefield.grid;
  container.style.backgroundImage = `url("./public/${resolveBackground(battlefield)}")`;
  container.innerHTML = "";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${grid.width} ${grid.height}`);
  svg.classList.add("hex-layer");

  const occupied = new Map(state.stacks.map((stack) => [stack.hexId, stack]));
  for (const hex of grid.hexes) {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", polygonPointsToString(hex.polygonPoints));
    polygon.dataset.hexId = String(hex.id);
    const classes = ["hex"];
    if (state.reachable.has(hex.id)) classes.push("reachable");
    if (occupied.has(hex.id)) classes.push("occupied");
    polygon.setAttribute("class", classes.join(" "));
    polygon.addEventListener("dragover", (event) => {
      if (state.phase === "setup") event.preventDefault();
    });
    polygon.addEventListener("drop", (event) => {
      event.preventDefault();
      const creatureId = Number(event.dataTransfer.getData("text/plain"));
      const stackId = event.dataTransfer.getData("application/x-stack-id");
      handlers.onDrop({ creatureId, stackId }, hex.id);
    });
    polygon.addEventListener("click", () => handlers.onHexClick(hex.id));
    svg.appendChild(polygon);
  }
  container.appendChild(svg);

  const stackLayer = document.createElement("div");
  stackLayer.className = "stack-layer";
  for (const stack of state.stacks) {
    const hex = grid.hexes.find((candidate) => candidate.id === stack.hexId);
    if (!hex) continue;
    const image = resolveCreatureImage(stack.creature);
    const element = document.createElement("button");
    element.type = "button";
    element.className = [
      "battle-stack",
      stack.owner,
      stack.id === state.selectedStackId ? "selected" : "",
      stack.id === state.activeStackId ? "active" : "",
      stack.statuses.acted ? "acted" : ""
    ].join(" ");
    element.style.left = `${hex.centerX}px`;
    element.style.top = `${hex.centerY}px`;
    element.dataset.stackId = stack.id;
    element.draggable = state.phase === "setup";
    element.innerHTML = `
      <img src="${image.src}" alt="${stack.label}" />
      <span class="stack-count">${stack.count}</span>
    `;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.onStackClick(stack.id);
    });
    element.addEventListener("mouseenter", () => handlers.onStackHover(stack.id));
    element.addEventListener("mouseleave", () => handlers.onStackHover(null));
    element.addEventListener("dragstart", (event) => {
      if (state.phase !== "setup") return;
      event.dataTransfer.setData("application/x-stack-id", stack.id);
      event.dataTransfer.effectAllowed = "move";
    });
    stackLayer.appendChild(element);
  }
  container.appendChild(stackLayer);
}
