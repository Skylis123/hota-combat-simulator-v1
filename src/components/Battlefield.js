import { resolveBackground, resolveCreatureImage } from "../engine/assetResolver.js";
import { polygonPointsToString } from "../engine/hexGrid.js";
import { footprintHexes, movementPlacementForHex, placementPreview, stackVisualPosition } from "../engine/footprint.js";
import { inferAbilityFlags } from "../engine/abilities.js";

export function renderBattlefield(container, data, state, handlers) {
  const battlefield = data.battlefield;
  const grid = battlefield.grid;
  const selectedBackground = data.backgrounds?.find((background) => background.id === state.backgroundId);
  container.style.backgroundImage = `url("./public/${selectedBackground?.image || resolveBackground(battlefield)}")`;
  container.innerHTML = "";
  setActionCursor(container, "default");
  container.classList.toggle("setup-mode", state.phase === "setup");
  container.ondragover = (event) => {
    if (state.phase !== "setup" || !event.dataTransfer.types.includes("application/x-stack-id")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    container.classList.add("drag-active");
    const stack = state.stacks.find((candidate) => candidate.id === container.dataset.dragStackId);
    const hex = hexFromPointer(event, container, grid);
    showPlacementPreview(container, grid, state, stack, hex?.id ?? null);
  };
  container.ondragleave = (event) => {
    if (!container.contains(event.relatedTarget)) {
      container.classList.remove("drag-active");
      clearPlacementPreview(container);
    }
  };
  container.ondrop = (event) => {
    if (state.phase !== "setup" || !event.dataTransfer.types.includes("application/x-stack-id")) return;
    event.preventDefault();
    container.classList.remove("drag-active");
    clearPlacementPreview(container);
    const hex = hexFromPointer(event, container, grid);
    if (!hex) return;
    const stackId = event.dataTransfer.getData("application/x-stack-id");
    handlers.onDrop({ stackId }, hex.id);
  };
  container.onpointermove = (event) => {
    if (state.phase !== "battle") return;
    const point = pointFromPointer(event, container, grid);
    const hex = hexFromPoint(point, grid);
    const active = state.stacks.find((stack) => stack.id === state.activeStackId);
    if (!hex || active?.owner !== "player") {
      setActionCursor(container, "default");
      clearMovementPreview(container);
      return;
    }
    const hoveredStack = occupied.get(hex.id)?.stack;
    if (hoveredStack && hoveredStack.owner !== active.owner) {
      const preview = handlers.onAttackHover(hoveredStack.id, point, hex.id);
      showAttackApproach(container, preview);
      clearMovementPreview(container);
      setActionCursor(container, preview?.cursor || "prohibited");
      return;
    }
    handlers.onAttackHover(null);
    clearAttackApproach(container);
    const movementPlacement = !hoveredStack ? movementPlacementForHex(grid, active, state.reachable, hex.id) : null;
    showMovementPreview(container, movementPlacement);
    if (movementPlacement) {
      setActionCursor(container, inferAbilityFlags(active.creature).flying ? "fly" : "move");
    } else {
      setActionCursor(container, "default");
    }
  };
  container.onpointerleave = () => {
    clearPlacementPreview(container);
    clearAttackApproach(container);
    clearMovementPreview(container);
    setActionCursor(container, "default");
    handlers.onAttackHover(null);
    handlers.onStackHover(null);
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
    (footprintHexes(grid, stack) || []).forEach((hexId, index) => occupied.set(hexId, { stack, role: index === 0 ? "primary" : "rear" }));
  }
  const activeStack = state.stacks.find((stack) => stack.id === state.activeStackId);
  const reachableFootprints = new Map();
  if (activeStack?.owner === "player") {
    for (const primaryHexId of state.reachable) {
      const hexIds = footprintHexes(grid, activeStack, primaryHexId) || [];
      hexIds.forEach((hexId, index) => {
        const roles = reachableFootprints.get(hexId) || new Set();
        roles.add(index === 0 ? "primary" : "rear");
        reachableFootprints.set(hexId, roles);
      });
    }
  }
  for (const hex of grid.hexes) {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", polygonPointsToString(hex.polygonPoints));
    polygon.dataset.hexId = String(hex.id);
    const classes = ["hex"];
    if (state.obstacleBlockedHexIds?.has(hex.id)) classes.push("obstacle-blocked");
    if (reachableFootprints.has(hex.id)) classes.push("reachable");
    if (reachableFootprints.get(hex.id)?.has("rear")) classes.push("reachable-wide-rear");
    const occupancy = occupied.get(hex.id);
    if (occupancy) classes.push("occupied", `occupied-${occupancy.role}`, `occupied-${occupancy.stack.owner}`);
    if (occupancy?.stack.id === state.activeStackId) classes.push("active-stack-hex");
    if (state.setupPreview?.hexIds?.includes(hex.id)) {
      classes.push(
        "placement-preview",
        hex.id === state.setupPreview.primaryHexId ? "placement-primary" : "placement-rear",
        state.setupPreview.valid ? "placement-valid" : "placement-invalid"
      );
    }
    polygon.setAttribute("class", classes.join(" "));
    polygon.addEventListener("click", (event) => {
      event.stopPropagation();
      const occupyingStack = occupied.get(hex.id)?.stack;
      if (occupyingStack) handlers.onStackClick(occupyingStack.id);
      else handlers.onHexClick(hex.id);
    });
    svg.appendChild(polygon);
  }
  container.appendChild(svg);

  const obstacleLayer = document.createElement("div");
  obstacleLayer.className = "obstacle-layer";
  const foregroundObstacleLayer = document.createElement("div");
  foregroundObstacleLayer.className = "obstacle-layer foreground-obstacle-layer";
  for (const obstacle of state.obstacles || []) {
    const element = document.createElement("button");
    element.type = "button";
    const hasDetectedPosition = Number.isFinite(obstacle.detectedLeft) && Number.isFinite(obstacle.detectedTop);
    element.className = `battle-obstacle ${obstacle.absolute ? "absolute" : "usual"} ${obstacle.foreground ? "foreground" : ""} ${hasDetectedPosition ? "detected-position" : ""}`;
    element.dataset.obstacleInstanceId = obstacle.instanceId;
    element.title = `${obstacle.name} · blocks ${obstacle.blockedHexIds.length} hexes · right-click to remove`;
    element.innerHTML = `<img src="./public/${obstacle.image}" alt="${obstacle.name}" />`;
    if (obstacle.detectedFlip) element.querySelector("img").style.transform = "scaleX(-1)";
    if (hasDetectedPosition) {
      element.style.left = `${obstacle.detectedLeft}px`;
      element.style.top = `${obstacle.detectedTop}px`;
    } else if (obstacle.absolute) {
      element.style.left = `${obstacle.width}px`;
      element.style.top = `${obstacle.height}px`;
    } else {
      const anchor = grid.hexes.find((hex) => hex.id === obstacle.anchorHexId);
      if (!anchor) continue;
      element.style.left = `${anchor.centerX - 22}px`;
      element.style.top = `${anchor.centerY + 28}px`;
    }
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onObstacleRemove?.(obstacle.instanceId);
    });
    (obstacle.foreground ? foregroundObstacleLayer : obstacleLayer).appendChild(element);
  }
  container.appendChild(obstacleLayer);

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
    const visualPosition = stack.alive === false ? hex : stackVisualPosition(grid, stack) || hex;
    element.style.left = `${visualPosition.centerX}px`;
    element.style.top = `${visualPosition.centerY}px`;
    element.dataset.stackId = stack.id;
    element.dataset.hexId = String(stack.hexId);
    if (Number.isFinite(stack.detectionConfidence)) {
      element.dataset.detectionConfidence = stack.detectionConfidence.toFixed(4);
    }
    if (stack.screenshotBadgeBounds) {
      const { minX, minY, width, height } = stack.screenshotBadgeBounds;
      element.dataset.screenshotBadge = `${minX},${minY},${width},${height}`;
    }
    element.title = stackTitle(state, stack);
    element.draggable = state.phase === "setup";
    element.innerHTML = `
      <img src="${image.src}" alt="${stack.alive === false ? `${stack.label} corpse` : stack.label}" />
      ${stack.alive === false ? "" : `<span class="stack-count">${stack.count}</span>`}
    `;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const pointerHex = hexFromPointer(event, container, grid);
      const stackFootprint = footprintHexes(grid, stack) || [];
      const active = state.stacks.find((candidate) => candidate.id === state.activeStackId);
      const enemyOfActivePlayer = active?.owner === "player" && stack.owner !== active.owner;
      const attackCursor = container.dataset.actionCursor === "shoot" || container.dataset.actionCursor?.startsWith("attack-");
      const matchingAttackPreview = state.attackPreview?.targetId === stack.id;
      if (state.phase === "battle" && enemyOfActivePlayer && pointerHex && (!attackCursor || !matchingAttackPreview)) {
        handlers.onHexClick(pointerHex.id);
        return;
      }
      if (state.phase === "battle" && !enemyOfActivePlayer && pointerHex && !stackFootprint.includes(pointerHex.id)) {
        handlers.onHexClick(pointerHex.id);
        return;
      }
      handlers.onStackClick(stack.id);
    });
    element.addEventListener("mouseenter", () => handlers.onStackHover(stack.id));
    element.addEventListener("pointermove", (event) => {
      if (state.phase !== "battle") return;
      const active = state.stacks.find((candidate) => candidate.id === state.activeStackId);
      if (active?.owner !== "player" || stack.owner === active.owner) return;
      const point = pointFromPointer(event, container, grid);
      const pointerHex = hexFromPoint(point, grid);
      const targetFootprint = (footprintHexes(grid, stack) || [])
        .map((hexId) => grid.hexes.find((hex) => hex.id === hexId))
        .filter(Boolean);
      const hoveredTargetHexId = targetFootprint.reduce((best, hex) => {
        const distance = Math.hypot(hex.centerX - point.x, hex.centerY - point.y);
        return !best || distance < best.distance ? { id: hex.id, distance } : best;
      }, null)?.id ?? null;
      const preview = handlers.onAttackHover(stack.id, point, hoveredTargetHexId);
      showAttackApproach(container, preview);
      setActionCursor(container, preview?.cursor || "prohibited");
    });
    element.addEventListener("mouseleave", () => {
      handlers.onStackHover(null);
      handlers.onAttackHover(null);
      clearAttackApproach(container);
      setActionCursor(container, "default");
    });
    element.addEventListener("dragstart", (event) => {
      if (state.phase !== "setup") return;
      container.dataset.dragStackId = stack.id;
      event.dataTransfer.setData("application/x-stack-id", stack.id);
      event.dataTransfer.effectAllowed = "move";
    });
    element.addEventListener("dragend", () => {
      delete container.dataset.dragStackId;
      container.classList.remove("drag-active");
      clearPlacementPreview(container);
    });
    stackLayer.appendChild(element);
  }
  container.appendChild(stackLayer);
  container.appendChild(foregroundObstacleLayer);
}

function setActionCursor(container, action) {
  container.dataset.actionCursor = action || "default";
}

function clearAttackApproach(container) {
  container.querySelectorAll(".hex.attack-approach-preview").forEach((hex) => hex.classList.remove("attack-approach-preview"));
}

function clearMovementPreview(container) {
  container.querySelectorAll(".hex.movement-footprint-preview").forEach((hex) => {
    hex.classList.remove("movement-footprint-preview", "movement-footprint-primary", "movement-footprint-rear");
  });
}

function showMovementPreview(container, placement) {
  clearMovementPreview(container);
  if (!placement) return;
  for (const hexId of placement.hexIds) {
    container.querySelector(`.hex[data-hex-id="${hexId}"]`)?.classList.add(
      "movement-footprint-preview",
      hexId === placement.primaryHexId ? "movement-footprint-primary" : "movement-footprint-rear"
    );
  }
}

function showAttackApproach(container, preview) {
  clearAttackApproach(container);
  if (!preview?.option || preview.option.mode !== "melee") return;
  for (const hexId of preview.approachHexIds || [preview.approachHex]) {
    container.querySelector(`.hex[data-hex-id="${hexId}"]`)?.classList.add("attack-approach-preview");
  }
}

function clearPlacementPreview(container) {
  container.querySelectorAll(".hex.placement-preview").forEach((hex) => {
    hex.classList.remove("placement-preview", "placement-primary", "placement-rear", "placement-valid", "placement-invalid");
  });
}

function showPlacementPreview(container, grid, state, stack, hexId) {
  clearPlacementPreview(container);
  if (!stack || hexId === null) return;
  const preview = placementPreview(grid, state.stacks, stack, hexId);
  for (const previewHexId of preview.hexIds) {
    const polygon = container.querySelector(`.hex[data-hex-id="${previewHexId}"]`);
    if (!polygon) continue;
    polygon.classList.add(
      "placement-preview",
      previewHexId === preview.primaryHexId ? "placement-primary" : "placement-rear",
      preview.valid ? "placement-valid" : "placement-invalid"
    );
  }
}

function stackTitle(state, stack) {
  if (state.attackableTargetIds?.has(stack.id)) return "Attack this stack";
  if (state.enemyTargetIds?.has(stack.id)) return "Enemy stack is not reachable this turn";
  if (stack.id === state.activeStackId) return "Active stack";
  return stack.label;
}

function hexFromPointer(event, container, grid) {
  return hexFromPoint(pointFromPointer(event, container, grid), grid);
}

function pointFromPointer(event, container, grid) {
  const rect = container.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * grid.width,
    y: ((event.clientY - rect.top) / rect.height) * grid.height
  };
}

function hexFromPoint(point, grid) {
  const containingHex = grid.hexes.find((hex) => pointInPolygon(point.x, point.y, hex.polygonPoints));
  if (containingHex) return containingHex;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const hex of grid.hexes) {
    const distance = Math.hypot(hex.centerX - point.x, hex.centerY - point.y);
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
