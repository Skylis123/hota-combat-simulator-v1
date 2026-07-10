import { resolveBackground, resolveCreatureImage } from "../engine/assetResolver.js";
import { polygonPointsToString } from "../engine/hexGrid.js";
import { footprintHexes } from "../engine/footprint.js";
import { inferAbilityFlags } from "../engine/abilities.js";

export function renderBattlefield(container, data, state, handlers) {
  const battlefield = data.battlefield;
  const grid = battlefield.grid;
  container.style.backgroundImage = `url("./public/${resolveBackground(battlefield)}")`;
  container.innerHTML = "";
  container.classList.toggle("setup-mode", state.phase === "setup");
  container.ondragover = (event) => {
    if (state.phase !== "setup") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-stack-id") ? "move" : "copy";
    container.classList.add("drag-active");
  };
  container.ondragleave = (event) => {
    if (!container.contains(event.relatedTarget)) container.classList.remove("drag-active");
  };
  container.ondrop = (event) => {
    if (state.phase !== "setup") return;
    event.preventDefault();
    container.classList.remove("drag-active");
    const hex = hexFromPointer(event, container, grid);
    if (!hex) return;
    const creatureId = Number(event.dataTransfer.getData("application/x-creature-id") || event.dataTransfer.getData("text/plain"));
    const stackId = event.dataTransfer.getData("application/x-stack-id");
    handlers.onDrop({ creatureId, stackId }, hex.id);
  };
  container.onpointermove = (event) => {
    if (state.phase !== "setup") return;
    handlers.onSetupHover(hexFromPointer(event, container, grid)?.id ?? null);
  };
  container.onpointerleave = () => {
    if (state.phase === "setup") handlers.onSetupHover(null);
  };
  container.onclick = (event) => {
    if (event.target.closest(".battle-stack")) return;
    const hex = hexFromPointer(event, container, grid);
    if (hex) handlers.onHexClick(hex.id);
  };

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${grid.width} ${grid.height}`);
  svg.classList.add("hex-layer");

  const occupied = new Map();
  for (const stack of state.stacks) {
    if (stack.alive === false) continue;
    for (const hexId of footprintHexes(grid, stack) || []) occupied.set(hexId, stack);
  }
  for (const hex of grid.hexes) {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", polygonPointsToString(hex.polygonPoints));
    polygon.dataset.hexId = String(hex.id);
    const classes = ["hex"];
    if (state.reachable.has(hex.id)) classes.push("reachable");
    if (occupied.has(hex.id)) classes.push("occupied");
    if (state.setupPreview?.hexIds?.includes(hex.id)) {
      classes.push("placement-preview", state.setupPreview.valid ? "placement-valid" : "placement-invalid");
    }
    polygon.setAttribute("class", classes.join(" "));
    polygon.addEventListener("click", (event) => {
      event.stopPropagation();
      const occupyingStack = occupied.get(hex.id);
      if (occupyingStack) handlers.onStackClick(occupyingStack.id);
      else handlers.onHexClick(hex.id);
    });
    svg.appendChild(polygon);
  }
  container.appendChild(svg);

  const stackLayer = document.createElement("div");
  stackLayer.className = "stack-layer";
  for (const stack of state.stacks) {
    const hex = grid.hexes.find((candidate) => candidate.id === stack.hexId);
    if (!hex) continue;
    const castleCreature = stack.creature.creatureId >= 0 && stack.creature.creatureId <= 13;
    const image = stack.alive === false && castleCreature
      ? { src: `./public/assets/creatures/animations/${stack.creature.creatureId}/corpse.png` }
      : resolveCreatureImage(stack.creature, castleCreature ? "animation" : "preview");
    const element = document.createElement("button");
    element.type = "button";
    element.className = [
      "battle-stack",
      inferAbilityFlags(stack.creature).twoHex ? "two-hex" : "",
      stack.owner,
      stack.id === state.selectedStackId ? "selected" : "",
      stack.id === state.activeStackId ? "active" : "",
      stack.statuses.acted ? "acted" : "",
      stack.alive === false ? "dead" : "",
      state.attackableTargetIds?.has(stack.id) ? "targetable" : "",
      state.enemyTargetIds?.has(stack.id) && !state.attackableTargetIds?.has(stack.id) ? "unreachable-target" : ""
    ].join(" ");
    element.style.left = `${hex.centerX}px`;
    element.style.top = `${hex.centerY}px`;
    element.dataset.stackId = stack.id;
    element.title = stackTitle(state, stack);
    element.draggable = state.phase === "setup";
    element.innerHTML = `
      <img src="${image.src}" alt="${stack.alive === false ? `${stack.label} corpse` : stack.label}" />
      ${stack.alive === false ? "" : `<span class="stack-count">${stack.count}</span>`}
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

function stackTitle(state, stack) {
  if (state.attackableTargetIds?.has(stack.id)) return "Attack this stack";
  if (state.enemyTargetIds?.has(stack.id)) return "Enemy stack is not reachable this turn";
  if (stack.id === state.activeStackId) return "Active stack";
  return stack.label;
}

function hexFromPointer(event, container, grid) {
  const rect = container.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * grid.width;
  const y = ((event.clientY - rect.top) / rect.height) * grid.height;
  const containingHex = grid.hexes.find((hex) => pointInPolygon(x, y, hex.polygonPoints));
  if (containingHex) return containingHex;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const hex of grid.hexes) {
    const distance = Math.hypot(hex.centerX - x, hex.centerY - y);
    if (distance < nearestDistance) {
      nearest = hex;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= 28 ? nearest : null;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
