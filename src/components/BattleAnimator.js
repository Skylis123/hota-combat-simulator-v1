const PIKEMAN_ID = 0;
const ASSET_ROOT = "./public/assets/creatures/animations/0";

export function supportsBattleAnimation(stack) {
  return stack?.creature?.creatureId === PIKEMAN_ID;
}

export async function animateStackMove(container, grid, stack, destinationHexId) {
  if (!supportsBattleAnimation(stack) || stack.hexId === destinationHexId) return;
  const origin = findHex(grid, stack.hexId);
  const destination = findHex(grid, destinationHexId);
  if (!origin || !destination) return;

  const actor = createActor(container, stack, origin, "move");
  const original = hideOriginalStack(container, stack.id);
  setFacing(actor, destination.centerX < origin.centerX);
  const duration = movementDuration(origin, destination);

  try {
    await moveActor(actor, destination, duration);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

export async function animateStackAttack(container, grid, attacker, target, approachHexId) {
  if (!supportsBattleAnimation(attacker)) return;
  const origin = findHex(grid, attacker.hexId);
  const approach = findHex(grid, approachHexId) || origin;
  const targetHex = findHex(grid, target.hexId);
  if (!origin || !approach || !targetHex) return;

  const actor = createActor(container, attacker, origin, approachHexId === attacker.hexId ? attackName(approach, targetHex) : "move");
  const original = hideOriginalStack(container, attacker.id);

  try {
    if (approachHexId !== attacker.hexId) {
      setFacing(actor, approach.centerX < origin.centerX);
      await moveActor(actor, approach, movementDuration(origin, approach));
    }

    const animation = attackName(approach, targetHex);
    setFacing(actor, targetHex.centerX < approach.centerX);
    setAnimation(actor, animation);
    await wait(animation === "attack-down" ? 880 : 800);
  } finally {
    actor.remove();
    if (original) original.style.visibility = "";
  }
}

function createActor(container, stack, hex, animation) {
  const actor = document.createElement("div");
  actor.className = `battle-animation ${stack.owner}`;
  actor.style.left = `${hex.centerX}px`;
  actor.style.top = `${hex.centerY}px`;
  actor.innerHTML = `<img alt="" /><span class="stack-count">${stack.count}</span>`;
  setAnimation(actor, animation);
  container.appendChild(actor);
  return actor;
}

function setAnimation(actor, animation) {
  const image = actor.querySelector("img");
  image.src = `${ASSET_ROOT}/${animation}.gif?play=${Date.now()}`;
}

function setFacing(actor, facingLeft) {
  actor.classList.toggle("facing-left", facingLeft);
}

function hideOriginalStack(container, stackId) {
  const original = container.querySelector(`[data-stack-id="${stackId}"]`);
  if (original) original.style.visibility = "hidden";
  return original;
}

function attackName(attackerHex, targetHex) {
  const deltaY = targetHex.centerY - attackerHex.centerY;
  if (deltaY < -20) return "attack-up";
  if (deltaY > 20) return "attack-down";
  return "attack-front";
}

function findHex(grid, hexId) {
  return grid.hexes.find((hex) => hex.id === hexId);
}

function movementDuration(origin, destination) {
  const distance = Math.hypot(destination.centerX - origin.centerX, destination.centerY - origin.centerY);
  return Math.max(360, Math.min(1100, Math.round(distance * 3.2)));
}

async function moveActor(actor, destination, duration) {
  actor.style.setProperty("--move-duration", `${duration}ms`);
  await nextFrame();
  actor.classList.add("moving");
  actor.style.left = `${destination.centerX}px`;
  actor.style.top = `${destination.centerY}px`;
  await waitForTransition(actor, duration);
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
