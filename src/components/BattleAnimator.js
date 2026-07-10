import { inferAbilityFlags } from "../engine/abilities.js";
import { stackVisualPosition } from "../engine/footprint.js";

const CASTLE_MIN_ID = 0;
const CASTLE_MAX_ID = 13;

export function supportsBattleAnimation(stack) {
  const creatureId = Number(stack?.creature?.creatureId);
  return creatureId >= CASTLE_MIN_ID && creatureId <= CASTLE_MAX_ID;
}

export async function animateStackMove(container, grid, stack, path) {
  const destinationHexId = path?.[path.length - 1];
  if (!supportsBattleAnimation(stack) || stack.hexId === destinationHexId) return;
  validatePath(grid, stack.hexId, path);
  const origin = stackVisualPosition(grid, stack);
  if (!origin) return;
  const actor = createActor(container, stack, origin, "move");
  const original = hideOriginalStack(container, stack.id);
  try {
    await moveActorAlongPath(actor, grid, path);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

export async function animateStackAttack(container, grid, attacker, target, option) {
  if (!supportsBattleAnimation(attacker)) return;
  const approachPath = option.approachPath;
  validatePath(grid, attacker.hexId, approachPath);
  const approachHexId = approachPath[approachPath.length - 1];
  const origin = stackVisualPosition(grid, attacker);
  const approach = stackVisualPosition(grid, attacker, approachHexId) || origin;
  const targetHex = stackVisualPosition(grid, target);
  if (!origin || !approach || !targetHex) return;

  const firstAnimation = approachHexId === attacker.hexId ? attackName(approach, targetHex, option.mode) : "move";
  const actor = createActor(container, attacker, origin, firstAnimation);
  const original = hideOriginalStack(container, attacker.id);
  try {
    if (approachHexId !== attacker.hexId) await moveActorAlongPath(actor, grid, approachPath);
    const animation = attackName(approach, targetHex, option.mode);
    setFacing(actor, targetHex.centerX < approach.centerX);
    setAnimation(actor, attacker, animation);
    await wait(animation.endsWith("down") ? 900 : 820);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

export async function animateAttackResult(container, grid, attacker, target, result) {
  if (!result?.ok) return;
  await animateReaction(container, grid, target, target.alive === false ? "death" : "hit");
  if (result.retaliation) {
    await animateRetaliation(container, grid, target, attacker);
    await animateReaction(container, grid, attacker, attacker.alive === false ? "death" : "hit");
  }
}

async function animateRetaliation(container, grid, defender, attacker) {
  if (!supportsBattleAnimation(defender) || defender.alive === false) return;
  const defenderPosition = stackVisualPosition(grid, defender);
  const attackerPosition = stackVisualPosition(grid, attacker);
  if (!defenderPosition || !attackerPosition) return;
  const animation = attackName(defenderPosition, attackerPosition, "melee");
  const actor = createActor(container, defender, defenderPosition, animation);
  const original = hideOriginalStack(container, defender.id);
  setFacing(actor, attackerPosition.centerX < defenderPosition.centerX);
  try {
    await wait(animation.endsWith("down") ? 900 : 820);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

export async function animateStackDefend(container, grid, stack) {
  await animateReaction(container, grid, stack, "defend");
}

async function animateReaction(container, grid, stack, animation) {
  if (!supportsBattleAnimation(stack)) return;
  const position = stackVisualPosition(grid, stack);
  if (!position) return;
  const actor = createActor(container, stack, position, animation, animation !== "death");
  const original = hideOriginalStack(container, stack.id);
  try {
    await wait(animation === "death" ? 1400 : animation === "defend" ? 800 : 520);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

function createActor(container, stack, hex, animation, showCount = true) {
  const actor = document.createElement("div");
  actor.className = `battle-animation ${stack.owner} ${inferAbilityFlags(stack.creature).twoHex ? "two-hex" : ""}`;
  actor.dataset.owner = stack.owner;
  actor.dataset.creatureId = String(stack.creature.creatureId);
  actor.style.left = `${hex.centerX}px`;
  actor.style.top = `${hex.centerY}px`;
  actor.innerHTML = `<img alt="" />${showCount ? `<span class="stack-count">${stack.count}</span>` : ""}`;
  setFacing(actor, stack.owner === "ai");
  setAnimation(actor, stack, animation);
  container.appendChild(actor);
  return actor;
}

function setAnimation(actor, stack, animation) {
  const image = actor.querySelector("img");
  actor.dataset.animation = animation;
  image.src = `${assetRoot(stack)}/${animation}.gif?play=${Date.now()}`;
}

function assetRoot(stack) {
  return `./public/assets/creatures/animations/${stack.creature.creatureId}`;
}

function setFacing(actor, facingLeft) {
  actor.classList.toggle("facing-left", facingLeft);
}

function hideOriginalStack(container, stackId) {
  const original = container.querySelector(`[data-stack-id="${stackId}"]`);
  if (original) original.style.visibility = "hidden";
  return original;
}

function attackName(attackerHex, targetHex, mode) {
  const prefix = mode === "ranged" ? "shoot" : "attack";
  const deltaY = targetHex.centerY - attackerHex.centerY;
  if (deltaY < -20) return `${prefix}-up`;
  if (deltaY > 20) return `${prefix}-down`;
  return `${prefix}-front`;
}

function findHex(grid, hexId) {
  return grid.hexes.find((hex) => hex.id === hexId);
}

function validatePath(grid, originHexId, path) {
  if (!Array.isArray(path) || path.length === 0 || path[0] !== originHexId) {
    throw new Error("Battle animation received a path with an invalid origin.");
  }
  for (let index = 1; index < path.length; index += 1) {
    const previous = findHex(grid, path[index - 1]);
    if (!previous?.neighbors.includes(path[index])) {
      throw new Error("Battle animation path contains non-adjacent hexes.");
    }
  }
}

async function moveActorAlongPath(actor, grid, path) {
  actor.style.setProperty("--move-duration", "170ms");
  await nextFrame();
  actor.classList.add("moving");
  for (let index = 1; index < path.length; index += 1) {
    const previous = stackVisualPosition(grid, { ...actorStack(actor), hexId: path[index - 1] }, path[index - 1]) || findHex(grid, path[index - 1]);
    const destination = stackVisualPosition(grid, { ...actorStack(actor), hexId: path[index] }, path[index]) || findHex(grid, path[index]);
    setFacing(actor, destination.centerX < previous.centerX);
    actor.style.left = `${destination.centerX}px`;
    actor.style.top = `${destination.centerY}px`;
    await waitForTransition(actor, 170);
  }
}

function actorStack(actor) {
  return {
    owner: actor.dataset.owner,
    creature: { creatureId: Number(actor.dataset.creatureId) }
  };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function waitForTransition(element, duration) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, duration + 80);
    element.addEventListener("transitionend", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
