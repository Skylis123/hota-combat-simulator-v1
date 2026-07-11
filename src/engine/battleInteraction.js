import { attackOptions } from "./combat.js";
import { footprintHexes, stackVisualPosition } from "./footprint.js";

export function selectPointerAttack(grid, state, attacker, target, point = null) {
  const options = attackOptions(grid, state, attacker, target);
  if (!options.length) return { cursor: "prohibited", option: null, approachHex: null };
  if (options[0].mode === "ranged") {
    return { cursor: "shoot", option: options[0], approachHex: attacker.hexId };
  }

  const selected = options.reduce((best, option) => {
    const contact = attackContactPair(grid, attacker, target, option.approachHex);
    const position = contact?.attackerHex || stackVisualPosition(grid, attacker, option.approachHex);
    if (!position || !point) return best || { option, distance: 0 };
    const distance = Math.hypot(position.centerX - point.x, position.centerY - point.y);
    return !best || distance < best.distance ? { option, distance } : best;
  }, null)?.option;
  if (!selected) return { cursor: "prohibited", option: null, approachHex: null };
  return {
    cursor: directionalAttackCursor(grid, attacker, target, selected.approachHex),
    option: selected,
    approachHex: selected.approachHex
  };
}

export function directionalAttackCursor(grid, attacker, target, approachHex) {
  const contact = attackContactPair(grid, attacker, target, approachHex);
  const from = contact?.attackerHex || stackVisualPosition(grid, attacker, approachHex);
  const to = contact?.targetHex || stackVisualPosition(grid, target);
  if (!from || !to) return "attack-right";
  const angle = Math.atan2(to.centerY - from.centerY, to.centerX - from.centerX) * 180 / Math.PI;
  if (angle >= -22.5 && angle < 22.5) return "attack-right";
  if (angle >= 22.5 && angle < 67.5) return "attack-down-right";
  if (angle >= 67.5 && angle < 112.5) return "attack-down";
  if (angle >= 112.5 && angle < 157.5) return "attack-down-left";
  if (angle >= 157.5 || angle < -157.5) return "attack-left";
  if (angle >= -157.5 && angle < -112.5) return "attack-up-left";
  if (angle >= -112.5 && angle < -67.5) return "attack-up";
  return "attack-up-right";
}

export function attackContactPair(grid, attacker, target, approachHex) {
  const attackerHexes = footprintHexes(grid, attacker, approachHex) || [];
  const targetHexes = footprintHexes(grid, target) || [];
  for (const attackerHexId of attackerHexes) {
    const attackerHex = grid.hexes.find((hex) => hex.id === attackerHexId);
    if (!attackerHex) continue;
    for (const targetHexId of targetHexes) {
      const targetHex = grid.hexes.find((hex) => hex.id === targetHexId);
      if (targetHex?.neighbors.includes(attackerHexId)) return { attackerHex, targetHex };
    }
  }
  return null;
}
