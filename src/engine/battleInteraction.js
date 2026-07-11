import { attackOptions } from "./combat.js";
import { footprintHexes, stackVisualPosition } from "./footprint.js";

export function selectPointerAttack(grid, state, attacker, target, point = null, targetHexId = null) {
  const options = attackOptions(grid, state, attacker, target);
  if (!options.length) return { cursor: "prohibited", option: null, approachHex: null };
  if (options[0].mode === "ranged") {
    return { cursor: "shoot", option: options[0], approachHex: attacker.hexId, targetHexId };
  }

  const selected = options.reduce((best, option) => {
    const contact = attackContactPair(grid, attacker, target, option.approachHex, point, targetHexId);
    if (targetHexId !== null && !contact) return best;
    const position = contact?.attackerHex || stackVisualPosition(grid, attacker, option.approachHex);
    if (!position || !point) return best || { option, distance: 0 };
    const distance = Math.hypot(position.centerX - point.x, position.centerY - point.y);
    return !best || distance < best.distance ? { option, distance } : best;
  }, null)?.option;
  if (!selected) return { cursor: "prohibited", option: null, approachHex: null };
  const contact = attackContactPair(grid, attacker, target, selected.approachHex, point, targetHexId);
  return {
    cursor: directionalAttackCursor(grid, attacker, target, selected.approachHex, point, targetHexId),
    option: { ...selected, targetHexId: contact?.targetHex.id ?? targetHexId },
    approachHex: selected.approachHex,
    targetHexId: contact?.targetHex.id ?? targetHexId
  };
}

export function directionalAttackCursor(grid, attacker, target, approachHex, point = null, targetHexId = null) {
  const contact = attackContactPair(grid, attacker, target, approachHex, point, targetHexId);
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

export function attackContactPair(grid, attacker, target, approachHex, point = null, targetHexId = null) {
  const attackerHexes = footprintHexes(grid, attacker, approachHex) || [];
  const targetHexes = footprintHexes(grid, target) || [];
  const contacts = [];
  for (const attackerHexId of attackerHexes) {
    const attackerHex = grid.hexes.find((hex) => hex.id === attackerHexId);
    if (!attackerHex) continue;
    for (const targetHexId of targetHexes) {
      const targetHex = grid.hexes.find((hex) => hex.id === targetHexId);
      if (targetHex?.neighbors.includes(attackerHexId)) contacts.push({ attackerHex, targetHex });
    }
  }
  if (!contacts.length) return null;
  const matchingTargetContacts = targetHexId === null
    ? contacts
    : contacts.filter((contact) => contact.targetHex.id === targetHexId);
  if (targetHexId !== null && !matchingTargetContacts.length) return null;
  const candidates = matchingTargetContacts;
  if (!point || candidates.length === 1) return candidates[0];
  return candidates.reduce((best, contact) => {
    const distance = Math.hypot(contact.targetHex.centerX - point.x, contact.targetHex.centerY - point.y);
    return !best || distance < best.distance ? { contact, distance } : best;
  }, null).contact;
}
