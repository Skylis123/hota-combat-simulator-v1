const SUMMON_ONLY_CREATURE_ASSETS = Object.freeze({
  10001: Object.freeze({
    displayImage: "assets/creatures/png/10001.png",
    idleAnimation: "assets/creatures/animations/10001/idle.gif",
    previewImage: "assets/creatures/png/10001.png",
    spritesheet: "assets/creatures/spritesheets/10001.png",
    corpseImage: "assets/creatures/animations/10001/corpse.png",
    battleAnimationRoot: "assets/creatures/animations/10001",
    battleAnimationActions: [
      "move", "idle", "hit", "defend", "death",
      "attack-up", "attack-front", "attack-down", "corpse"
    ],
    assetStatus: "EXTRACTED_SUMMON_ONLY",
    sourceArchive: "VCMI Horn of the Abyss Factory mod 1.1.6",
    sourceAsset: "CLARVA.def",
    sourceSha256: "79ebc029166392dd1f6032bad6a65064490b9e0d4fb3b72790f7377d6c26ebd3",
    fallbackReason: null
  })
});

export function resolveCreatureImage(creature, mode = "preview") {
  const asset = creatureAsset(creature);
  const chosen = mode === "animation"
    ? asset.idleAnimation || asset.previewImage || asset.displayImage
    : asset.previewImage || asset.idleAnimation || asset.displayImage;
  return {
    src: publicAssetUrl(chosen || "assets/placeholders/creature-placeholder.svg"),
    status: asset.assetStatus || "UNRESOLVED",
    fallbackReason: asset.fallbackReason || null
  };
}

export function resolveCreatureBattleAnimation(creature, animation = "idle") {
  const asset = creatureAsset(creature);
  const assetPath = battleAnimationPath(creature, animation);
  if (!assetPath) return null;
  return {
    src: publicAssetUrl(assetPath),
    status: asset.assetStatus || "UNRESOLVED"
  };
}

export function resolveCreatureCorpseImage(creature) {
  return resolveCreatureBattleAnimation(creature, "corpse");
}

export function resolveBackground(battlefield) {
  return battlefield?.background?.image || "assets/battlefields/backgrounds/cmbkgrtr.png";
}

function publicAssetUrl(assetPath) {
  if (!assetPath) return "./public/assets/placeholders/creature-placeholder.svg";
  if (assetPath.startsWith("http") || assetPath.startsWith("./public/")) return assetPath;
  if (assetPath.startsWith("assets/")) return `./public/${assetPath}`;
  return assetPath;
}

function battleAnimationPath(creature, animation) {
  const asset = creatureAsset(creature);
  if (animation === "corpse" && asset.corpseImage) return asset.corpseImage;

  const animations = asset.battleAnimations?.files || asset.battleAnimations || asset.animations;
  const mapped = animations && typeof animations === "object" && !Array.isArray(animations)
    ? animations[animation]
    : null;
  const mappedPath = typeof mapped === "string" ? mapped : mapped?.src || mapped?.path || mapped?.image;
  if (mappedPath) return mappedPath;

  const available = asset.battleAnimationActions
    || asset.availableAnimations
    || (Array.isArray(asset.battleAnimations?.actions) ? asset.battleAnimations.actions : null);
  if (Array.isArray(available) && !available.includes(animation)) return null;

  const root = battleAnimationRoot(asset);
  if (!root) return null;
  return `${root.replace(/\/$/, "")}/${animation}.${animation === "corpse" ? "png" : "gif"}`;
}

function creatureAsset(creature) {
  return creature?.asset || SUMMON_ONLY_CREATURE_ASSETS[Number(creature?.creatureId)] || {};
}

function battleAnimationRoot(asset) {
  const explicit = asset.battleAnimationRoot || asset.animationRoot || asset.battleAnimations?.root;
  if (typeof explicit === "string" && explicit) return explicit;

  if (typeof asset.idleAnimation === "string" && asset.idleAnimation) {
    return asset.idleAnimation.replace(/\/idle\.[a-z0-9]+(?:\?.*)?$/i, "");
  }

  // Compatibility for the existing extracted roster. Availability is gated by
  // extraction status and derived from the asset path rather than creature IDs.
  const status = String(asset.assetStatus || "").toUpperCase();
  if (!status.includes("EXTRACTED")) return null;
  const visual = asset.previewImage || asset.displayImage || asset.spritesheet;
  if (typeof visual !== "string") return null;
  const match = visual.match(/^(.*\/creatures\/)(?:png|spritesheets)\/([^/]+)\.[a-z0-9]+$/i);
  return match ? `${match[1]}animations/${match[2]}` : null;
}
