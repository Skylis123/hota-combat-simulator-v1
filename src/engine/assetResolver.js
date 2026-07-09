export function resolveCreatureImage(creature, mode = "preview") {
  const asset = creature?.asset || {};
  const chosen = mode === "animation"
    ? asset.idleAnimation || asset.previewImage || asset.displayImage
    : asset.previewImage || asset.idleAnimation || asset.displayImage;
  return {
    src: publicAssetUrl(chosen || "assets/placeholders/creature-placeholder.svg"),
    status: asset.assetStatus || "UNRESOLVED",
    fallbackReason: asset.fallbackReason || null
  };
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
