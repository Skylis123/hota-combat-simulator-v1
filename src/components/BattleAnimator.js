import { inferAbilityFlags } from "../engine/abilities.js";
import { resolveCreatureBattleAnimation } from "../engine/assetResolver.js";
import { stackVisualPosition } from "../engine/footprint.js";

export function supportsBattleAnimation(stack, animation = "idle") {
  return Boolean(resolveCreatureBattleAnimation(stack?.creature, animation));
}

export async function animateStackMove(container, grid, stack, path) {
  const destinationHexId = path?.[path.length - 1];
  if (!supportsBattleAnimation(stack, "move") || stack.hexId === destinationHexId) return;
  validatePath(grid, stack.hexId, path);
  const origin = stackVisualPosition(grid, stack);
  if (!origin) return;
  const actor = createActor(container, stack, origin, "move");
  const original = hideOriginalStack(container, stack.id);
  try {
    await moveActorForStack(actor, grid, stack, path);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

export async function animateStackAttack(container, grid, attacker, target, option) {
  const approachPath = option.approachPath;
  validatePath(grid, attacker.hexId, approachPath);
  const approachHexId = approachPath[approachPath.length - 1];
  const origin = stackVisualPosition(grid, attacker);
  const approach = stackVisualPosition(grid, attacker, approachHexId) || origin;
  const targetHex = stackVisualPosition(grid, target);
  if (!origin || !approach || !targetHex) return;

  const animation = attackName(approach, targetHex, option.mode);
  if (!supportsBattleAnimation(attacker, animation)) return;
  if (approachHexId !== attacker.hexId && !supportsBattleAnimation(attacker, "move")) return;
  const firstAnimation = approachHexId === attacker.hexId ? animation : "move";
  const actor = createActor(container, attacker, origin, firstAnimation);
  const original = hideOriginalStack(container, attacker.id);
  try {
    if (approachHexId !== attacker.hexId) await moveActorForStack(actor, grid, attacker, approachPath);
    setFacing(actor, targetHex.centerX < approach.centerX);
    setAnimation(actor, attacker, animation);
    await wait(animation.endsWith("down") ? 900 : 820);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

export async function animateAttackResult(container, grid, attacker, target, result, option = null) {
  if (!result?.ok) return;
  syncStackElement(container, grid, attacker);
  for (let index = 0; index < result.attackLog.length; index += 1) {
    const strike = result.attackLog[index];
    if (index > 0) await animateStackStrike(container, grid, attacker, target, option?.mode || result.mode);
    syncStackSnapshot(container, grid, target, strike.after);
    const stagedTarget = { ...target, ...strike.after, alive: strike.after.count > 0 };
    await animateReaction(container, grid, stagedTarget, strike.after.count <= 0 ? "death" : target.statuses.defending ? "defend" : "hit");
  }
  if (result.retaliation) {
    await animateRetaliation(container, grid, target, attacker);
    await animateReaction(container, grid, attacker, attacker.alive === false ? "death" : "hit");
  }
}

async function animateStackStrike(container, grid, attacker, target, mode) {
  const attackerPosition = stackVisualPosition(grid, attacker);
  const targetPosition = stackVisualPosition(grid, target);
  if (!attackerPosition || !targetPosition) return;
  const animation = attackName(attackerPosition, targetPosition, mode);
  if (!supportsBattleAnimation(attacker, animation)) return;
  const actor = createActor(container, attacker, attackerPosition, animation);
  const original = hideOriginalStack(container, attacker.id);
  setFacing(actor, targetPosition.centerX < attackerPosition.centerX);
  try {
    await wait(animation.endsWith("down") ? 900 : 820);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

function syncStackElement(container, grid, stack) {
  const element = container.querySelector(`[data-stack-id="${stack.id}"]`);
  const position = stackVisualPosition(grid, stack);
  if (!element || !position) return;
  element.style.left = `${position.centerX}px`;
  element.style.top = `${position.centerY}px`;
  element.dataset.hexId = String(stack.hexId);
  const count = element.querySelector(".stack-count");
  if (count) count.textContent = String(stack.count);
}

function syncStackSnapshot(container, grid, stack, snapshot) {
  const element = container.querySelector(`[data-stack-id="${stack.id}"]`);
  const position = stackVisualPosition(grid, stack);
  if (!element || !position) return;
  element.style.left = `${position.centerX}px`;
  element.style.top = `${position.centerY}px`;
  const count = element.querySelector(".stack-count");
  if (count) count.textContent = String(snapshot.count);
  element.classList.toggle("dead", snapshot.count <= 0);
}

async function animateRetaliation(container, grid, defender, attacker) {
  if (defender.alive === false) return;
  const defenderPosition = stackVisualPosition(grid, defender);
  const attackerPosition = stackVisualPosition(grid, attacker);
  if (!defenderPosition || !attackerPosition) return;
  const animation = attackName(defenderPosition, attackerPosition, "melee");
  if (!supportsBattleAnimation(defender, animation)) return;
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
  if (!supportsBattleAnimation(stack, animation)) return;
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
  const resolved = resolveCreatureBattleAnimation(stack.creature, animation);
  if (!resolved) return;
  actor.dataset.animation = animation;
  const separator = resolved.src.includes("?") ? "&" : "?";
  image.src = `${resolved.src}${separator}play=${Date.now()}`;
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

async function moveActorForStack(actor, grid, stack, path) {
  if (inferAbilityFlags(stack.creature).underground) {
    await moveActorUnderground(actor, grid, path);
    return;
  }
  await moveActorAlongPath(actor, grid, path);
}

async function moveActorUnderground(actor, grid, path) {
  const animatedStack = actorStack(actor);
  const origin = stackVisualPosition(grid, { ...animatedStack, hexId: path[0] }, path[0]) || findHex(grid, path[0]);
  const destinationHexId = path[path.length - 1];
  const destination = stackVisualPosition(grid, { ...animatedStack, hexId: destinationHexId }, destinationHexId) || findHex(grid, destinationHexId);
  if (!origin || !destination) return;
  actor.classList.add("burrowing");
  await nextFrame();
  actor.classList.add("burrowed");
  await waitForTransition(actor, 240);
  setFacing(actor, destination.centerX < origin.centerX);
  actor.style.left = `${destination.centerX}px`;
  actor.style.top = `${destination.centerY}px`;
  await nextFrame();
  actor.classList.remove("burrowed");
  await waitForTransition(actor, 280);
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
